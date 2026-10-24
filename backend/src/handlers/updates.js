// Nurse updates (FR-13 to FR-17) and their AI processing step (FR-18 to FR-25).
//
// Persistence and AI processing are deliberately two separate operations:
//   POST .../updates          -> save the update, return 201 immediately
//   POST .../updates/{id}/process -> run Bedrock, store proposals separately
//
// This enforces NFR-3 / FR-42: a failed or slow AI request can never lose or
// overwrite the original update. The update is the source of truth; AI output
// is always a separate, proposed record that references it.
//
// Permissions:
//   create  - any provisioned nurse or charge nurse; the author is always the
//             authenticated application user, never a value from the body
//   edit    - the original author only (FR-17)
//   process - charge nurse only; the resulting recommendations are reviewed
//             by the charge nurse (FR-32, FR-33)

import {
  PutCommand, GetCommand, UpdateCommand, QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import { createHash } from 'node:crypto';
import {
  updateKey, recommendationKey, incidentMetaKey, patientKey, incidentPk, ENTITY,
} from '../lib/keys.js';
import { newUpdateId, newRecId, nowIso } from '../lib/ids.js';
import { writeAudit, AUDIT_ACTIONS } from '../lib/audit.js';
import { processUpdate, BedrockError } from '../lib/bedrock.js';
import { authenticate, requireRole, ROLES } from '../lib/auth.js';
import {
  ok, created, withErrorHandling, parseBody, HttpError,
} from '../lib/http.js';

const CATEGORIES = [
  'Patient concern', 'Patient update', 'Delayed task', 'Completed task',
  'Supply request', 'Staffing', 'Handoff', 'Verification', 'Other',
];

// A browser-generated id for one submission. Retrying the same submission
// (double click, timeout, flaky network) must not create a second update.
const CLIENT_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

// Deterministic per author, so one nurse's request id can never collide with
// or reveal another nurse's update.
function updateIdForRequest(userId, clientRequestId) {
  const digest = createHash('sha256').update(`${userId}:${clientRequestId}`).digest('hex');
  return `UPD-${digest.slice(0, 16)}`;
}

async function assertPatientExists(incidentId, patientId) {
  if (typeof patientId !== 'string') {
    throw new HttpError(400, 'invalid_patient', 'Choose a patient from this incident.');
  }
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: patientKey(incidentId, patientId),
  }));
  if (!res.Item) throw new HttpError(400, 'invalid_patient', 'Choose a patient from this incident.');
}

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
  const actor = await authenticate(event);
  requireRole(actor, ROLES.NURSE, ROLES.CHARGE_NURSE);
  const { incidentId } = event.pathParameters || {};
  const body = parseBody(event);

  if (!body.patient) throw new HttpError(400, 'missing_patient', 'A patient is required.');
  if (!body.text || !String(body.text).trim()) {
    throw new HttpError(400, 'missing_text', 'Update text is required.');
  }
  const category = CATEGORIES.includes(body.category) ? body.category : 'Other';
  if (body.clientRequestId !== undefined
    && (typeof body.clientRequestId !== 'string' || !CLIENT_REQUEST_ID.test(body.clientRequestId))) {
    throw new HttpError(400, 'invalid_request_id', 'Invalid request id.');
  }

  await assertIncidentActive(incidentId);
  await assertPatientExists(incidentId, body.patient);

  const updateId = body.clientRequestId
    ? updateIdForRequest(actor.userId, body.clientRequestId)
    : newUpdateId();
  const createdAt = nowIso();
  const item = {
    ...updateKey(incidentId, updateId),
    entity: ENTITY.UPDATE,
    incidentId,
    id: updateId,
    patient: body.patient,
    nurse: actor.userId,            // FR-15: author is the authenticated user; body.nurse is ignored
    createdAt,                      // FR-15 / NFR-13: timestamp
    urgent: Boolean(body.urgent),   // FR-16
    category,
    text: String(body.text),        // original source text, never overwritten
    structured: body.structured ?? null, // FR-13: optional structured form fields
    editHistory: [],                // FR-17: corrections appended here
    processing: 'not_processed',    // not_processed | pending | processed | failed
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException' || !body.clientRequestId) throw err;
    // A retry of a submission that already saved: return the stored update
    // unchanged (it may since have been corrected) instead of a duplicate.
    const prior = await ddb.send(new GetCommand({
      TableName: TABLE_NAME, Key: updateKey(incidentId, updateId),
    }));
    if (prior.Item?.nurse !== actor.userId) {
      throw new HttpError(409, 'conflict', 'This update could not be saved. Try again.');
    }
    return ok(prior.Item);
  }

  await writeAudit(incidentId, {
    actor,
    action: AUDIT_ACTIONS.UPDATE_CREATED, targetId: updateId,
    summary: { patient: body.patient, urgent: item.urgent, category },
  });

  // 201 confirms the save independently of any later AI step (NFR-3, NFR-5).
  return created(item);
}

// FR-17: a user may correct ONLY their own update, preserving original content
// and a correction history. The prior text, category, and urgent flag are
// pushed into editHistory before the new values are written.
async function editUpdate(event) {
  const actor = await authenticate(event);
  const { incidentId, updateId } = event.pathParameters || {};
  const body = parseBody(event);
  if (!body.text || !String(body.text).trim()) {
    throw new HttpError(400, 'missing_text', 'Updated text is required.');
  }
  if (body.category !== undefined && !CATEGORIES.includes(body.category)) {
    throw new HttpError(400, 'invalid_category', 'Unknown update category.');
  }
  if (body.urgent !== undefined && typeof body.urgent !== 'boolean') {
    throw new HttpError(400, 'invalid_urgent', 'Urgent must be true or false.');
  }

  const existing = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: updateKey(incidentId, updateId),
  }));
  if (!existing.Item) throw new HttpError(404, 'not_found', 'Update not found.');
  if (existing.Item.nurse !== actor.userId) {
    // Ownership check — authors correct only their own updates, including charge nurses.
    throw new HttpError(403, 'forbidden', 'You can only edit your own updates.');
  }

  const editedAt = nowIso();
  let res;
  try {
    res = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: updateKey(incidentId, updateId),
      // Re-check ownership atomically so a concurrent change cannot slip through.
      ConditionExpression: 'nurse = :author',
      UpdateExpression:
        'SET #text = :newText, category = :category, urgent = :urgent, '
        + 'editHistory = list_append(editHistory, :entry), editedAt = :editedAt',
      ExpressionAttributeNames: { '#text': 'text' },
      ExpressionAttributeValues: {
        ':author': actor.userId,
        ':newText': String(body.text),
        ':category': body.category ?? existing.Item.category,
        ':urgent': body.urgent ?? Boolean(existing.Item.urgent),
        ':editedAt': editedAt,
        // Preserve the prior version and when it was replaced (FR-17 / NFR-14).
        ':entry': [{
          text: existing.Item.text,
          category: existing.Item.category,
          urgent: Boolean(existing.Item.urgent),
          replacedAt: editedAt,
          by: actor.userId,
        }],
      },
      ReturnValues: 'ALL_NEW',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new HttpError(403, 'forbidden', 'You can only edit your own updates.');
    }
    throw err;
  }

  await writeAudit(incidentId, {
    actor,
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
  const actor = await authenticate(event);
  requireRole(actor, ROLES.CHARGE_NURSE);
  const { incidentId, updateId } = event.pathParameters || {};

  const existing = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: updateKey(incidentId, updateId),
  }));
  if (!existing.Item) throw new HttpError(404, 'not_found', 'Update not found.');
  const update = existing.Item;

  // Claim the update for processing. A retry, double click, or concurrent
  // request cannot run the model twice and duplicate recommendations; an
  // update whose processing failed may be retried.
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: updateKey(incidentId, updateId),
      ConditionExpression: 'attribute_exists(PK) AND processing <> :pending AND processing <> :processed',
      UpdateExpression: 'SET processing = :pending',
      ExpressionAttributeValues: { ':pending': 'pending', ':processed': 'processed' },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new HttpError(409, 'already_processed', 'AI review already ran or is running for this update.');
    }
    throw err;
  }

  let result;
  try {
    const { patient, recentUpdates } = await loadPatientContext(incidentId, update.patient);
    result = await processUpdate({ update, patient, recentUpdates });
  } catch (err) {
    // Error names/codes only: never log update text or model output.
    console.error('bedrock_failed', err?.name, err?.code, err instanceof BedrockError ? err.message : '');
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
      priority: rec.priority,                  // FR-21: suggested priority, editable on approval
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
    actor,
    action: AUDIT_ACTIONS.UPDATE_PROCESSED, targetId: updateId,
    summary: { recommendationIds: recommendations.map((r) => r.id) },
  });

  return created({
    updateId,
    verifyBeforeActing: true, // FR-24
    recommendations,
  });
}

// Read-only context for the model: the patient's continuity profile and their
// most recent updates (FR-20, FR-21). Their ids become the only sources the
// model may cite.
async function loadPatientContext(incidentId, patientId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': incidentPk(incidentId) },
      ExclusiveStartKey,
    }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const patient = items.find((i) => i.entity === ENTITY.PATIENT && i.id === patientId) ?? null;
  const recentUpdates = items
    .filter((i) => i.entity === ENTITY.UPDATE && i.patient === patientId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 10);
  return { patient, recentUpdates };
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
