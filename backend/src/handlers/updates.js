// Nurse updates (FR-13 to FR-17) and their AI processing step (FR-18 to FR-25).
//
// Persistence and AI processing are deliberately two separate operations:
//   POST .../updates          -> save the update, return 201 immediately
//   POST .../updates/{id}/process -> run Bedrock, store proposals separately
//
// This enforces NFR-3 / FR-42: a failed or slow AI request can never lose or
// overwrite the original update. The update is the source of truth; AI output
// is always a separate, proposed record that references it.

import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import {
  updateKey, recommendationKey, incidentMetaKey, ENTITY,
} from '../lib/keys.js';
import { newUpdateId, newRecId, nowIso } from '../lib/ids.js';
import { writeAudit, AUDIT_ACTIONS } from '../lib/audit.js';
import { processUpdate } from '../lib/bedrock.js';
import {
  ok, created, withErrorHandling, parseBody, getActor, ROLES, HttpError,
} from '../lib/http.js';

const CATEGORIES = [
  'Patient concern', 'Patient update', 'Delayed task', 'Completed task',
  'Supply request', 'Staffing', 'Handoff', 'Verification', 'Other',
];

async function assertIncidentActive(incidentId) {
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: incidentMetaKey(incidentId),
  }));
  if (!res.Item) throw new HttpError(404, 'not_found', 'Incident not found.');
  if (res.Item.status !== 'active') {
    throw new HttpError(409, 'incident_closed', 'Incident is not active.');
  }
}

// FR-13 to FR-16. Saves the update and nothing else; no AI call here (NFR-5).
async function createUpdate(event) {
  const actor = getActor(event);
  const { incidentId } = event.pathParameters || {};
  const body = parseBody(event);

  if (!body.patient) throw new HttpError(400, 'missing_patient', 'A patient is required.');
  if (!body.text || !String(body.text).trim()) {
    throw new HttpError(400, 'missing_text', 'Update text is required.');
  }
  const category = CATEGORIES.includes(body.category) ? body.category : 'Other';

  await assertIncidentActive(incidentId);

  const updateId = newUpdateId();
  const createdAt = nowIso();
  const item = {
    ...updateKey(incidentId, updateId),
    entity: ENTITY.UPDATE,
    incidentId,
    id: updateId,
    patient: body.patient,
    nurse: actor.userId,            // FR-15: author association
    createdAt,                      // FR-15 / NFR-13: timestamp
    urgent: Boolean(body.urgent),   // FR-16
    category,
    text: String(body.text),        // original source text, never overwritten
    structured: body.structured ?? null, // FR-13: optional structured form fields
    editHistory: [],                // FR-17: corrections appended here
    processing: 'not_processed',    // not_processed | pending | processed | failed
  };

  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));

  await writeAudit(incidentId, {
    actorId: actor.userId, actorRole: actor.role,
    action: AUDIT_ACTIONS.UPDATE_CREATED, targetId: updateId,
    summary: { patient: body.patient, urgent: item.urgent, category },
  });

  // 201 confirms the save independently of any later AI step (NFR-3, NFR-5).
  return created(item);
}

// FR-17: a nurse may correct ONLY their own update, preserving original content
// and a correction history. The original text is pushed into editHistory.
async function editUpdate(event) {
  const actor = getActor(event);
  const { incidentId, updateId } = event.pathParameters || {};
  const body = parseBody(event);
  if (!body.text || !String(body.text).trim()) {
    throw new HttpError(400, 'missing_text', 'Updated text is required.');
  }

  const existing = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: updateKey(incidentId, updateId),
  }));
  if (!existing.Item) throw new HttpError(404, 'not_found', 'Update not found.');
  if (existing.Item.nurse !== actor.userId) {
    // Ownership check — nurses correct only their own updates.
    throw new HttpError(403, 'forbidden', 'You can only edit your own updates.');
  }

  const editedAt = nowIso();
  const res = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: updateKey(incidentId, updateId),
    UpdateExpression:
      'SET #text = :newText, editHistory = list_append(editHistory, :entry), editedAt = :editedAt',
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: {
      ':newText': String(body.text),
      ':editedAt': editedAt,
      // Preserve the prior text and when it was replaced (FR-17 / NFR-14).
      ':entry': [{ text: existing.Item.text, replacedAt: editedAt, by: actor.userId }],
    },
    ReturnValues: 'ALL_NEW',
  }));

  await writeAudit(incidentId, {
    actorId: actor.userId, actorRole: actor.role,
    action: AUDIT_ACTIONS.UPDATE_EDITED, targetId: updateId,
    summary: { revision: res.Attributes.editHistory.length },
  });

  return ok(res.Attributes);
}

// FR-18 to FR-23: run Bedrock over a saved update and persist the resulting
// proposals as separate REC items (status 'proposed'). The source update is
// read, never mutated beyond a processing-status flag. If Bedrock fails, the
// update is marked 'failed' and still fully available (NFR-3).
async function processUpdateHandler(event) {
  const actor = getActor(event);
  const { incidentId, updateId } = event.pathParameters || {};

  const existing = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: updateKey(incidentId, updateId),
  }));
  if (!existing.Item) throw new HttpError(404, 'not_found', 'Update not found.');
  const update = existing.Item;

  let result;
  try {
    result = await processUpdate({ update });
  } catch (err) {
    console.error('bedrock_failed', err?.name, err?.message);
    await setProcessing(incidentId, updateId, 'failed');
    // Distinct from a save failure: the update is intact; only AI failed (NFR-2).
    throw new HttpError(502, 'ai_unavailable',
      'AI processing failed. The original update is saved and unchanged.');
  }

  const createdAt = nowIso();
  const recommendations = (result.recommendations || []).map((rec) => {
    const recId = newRecId();
    return {
      ...recommendationKey(incidentId, recId),
      entity: ENTITY.REC,
      incidentId,
      id: recId,
      patient: update.patient,
      title: rec.title,
      reason: rec.reason,                      // NFR-22: concise explanation
      sourceUpdateIds: rec.sourceUpdateIds,    // FR-22 / NFR-23: supporting sources
      aiGenerated: true,                       // FR-23: labeled as AI output
      status: 'proposed',                      // requires human approval (NFR-24)
      createdAt,
    };
  });

  // Store each proposal as its own item; AI output never touches source data.
  for (const rec of recommendations) {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: rec }));
  }
  await setProcessing(incidentId, updateId, 'processed');

  await writeAudit(incidentId, {
    actorId: actor.userId, actorRole: actor.role,
    action: AUDIT_ACTIONS.UPDATE_PROCESSED, targetId: updateId,
    summary: { recommendationIds: recommendations.map((r) => r.id) },
  });

  return created({
    updateId,
    verifyBeforeActing: true, // FR-24
    recommendations,
  });
}

async function setProcessing(incidentId, updateId, status) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: updateKey(incidentId, updateId),
    UpdateExpression: 'SET processing = :p',
    ExpressionAttributeValues: { ':p': status },
  }));
}

export const handler = withErrorHandling(async (event) => {
  const method = event.httpMethod;
  const path = event.resource || '';
  if (method === 'POST' && path.endsWith('/process')) return processUpdateHandler(event);
  if (method === 'POST') return createUpdate(event);
  if (method === 'PATCH') return editUpdate(event);
  throw new HttpError(405, 'method_not_allowed', 'Unsupported method.');
});
