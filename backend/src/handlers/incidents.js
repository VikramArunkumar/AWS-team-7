// Incident lifecycle (FR-5 to FR-8).
// Activation and deactivation are charge-nurse actions and are audited.
// Any provisioned user may read incident status and duration (FR-7).

import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import { incidentMetaKey, ENTITY } from '../lib/keys.js';
import { newIncidentId, nowIso } from '../lib/ids.js';
import { writeAudit, AUDIT_ACTIONS } from '../lib/audit.js';
import { authenticate, requireRole, ROLES } from '../lib/auth.js';
import {
  ok, created, withErrorHandling, parseBody, HttpError,
} from '../lib/http.js';

const VALID_TYPES = [
  'EHR outage',
  'Medication-system outage',
  'Staffing disruption',
  'Hospital communication outage',
];

async function createIncident(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.CHARGE_NURSE); // FR-5

  const body = parseBody(event);
  if (!VALID_TYPES.includes(body.type)) {
    throw new HttpError(400, 'invalid_type', 'Unknown crisis type.'); // FR-6
  }

  const incidentId = newIncidentId();
  const startedAt = nowIso();
  const item = {
    ...incidentMetaKey(incidentId),
    entity: ENTITY.INCIDENT,
    incidentId,
    type: body.type,
    unit: body.unit ?? null,
    status: 'active',
    startedAt, // FR-7: duration is derived from startedAt on read
    endedAt: null,
    activatedBy: actor.userId,
  };

  // Guard against overwriting an existing incident with the same id.
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK)',
  }));

  await writeAudit(incidentId, {
    actor,
    action: AUDIT_ACTIONS.INCIDENT_ACTIVATED,
    targetId: incidentId,
    summary: { type: body.type },
  });

  return created(item);
}

async function getIncident(event) {
  await authenticate(event); // nurses and charge nurses may view status (FR-7)
  const { incidentId } = event.pathParameters || {};
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: incidentMetaKey(incidentId),
  }));
  if (!res.Item) throw new HttpError(404, 'not_found', 'Incident not found.');
  return ok(withDuration(res.Item));
}

async function deactivateIncident(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.CHARGE_NURSE); // FR-8
  const { incidentId } = event.pathParameters || {};
  const endedAt = nowIso();

  let res;
  try {
    res = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: incidentMetaKey(incidentId),
      ConditionExpression: 'attribute_exists(PK) AND #s = :active',
      UpdateExpression: 'SET #s = :closed, endedAt = :endedAt, closedBy = :by',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':active': 'active', ':closed': 'closed', ':endedAt': endedAt, ':by': actor.userId,
      },
      ReturnValues: 'ALL_NEW',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new HttpError(409, 'not_active', 'Incident does not exist or is not active.');
    }
    throw err;
  }

  await writeAudit(incidentId, {
    actor,
    action: AUDIT_ACTIONS.INCIDENT_DEACTIVATED,
    targetId: incidentId,
  });

  return ok(withDuration(res.Attributes));
}

// FR-7: expose elapsed duration without depending on the viewer's clock/locale.
function withDuration(item) {
  const end = item.endedAt ? Date.parse(item.endedAt) : Date.now();
  return { ...item, durationMinutes: Math.max(0, Math.floor((end - Date.parse(item.startedAt)) / 60000)) };
}

export const handler = withErrorHandling(async (event) => {
  const method = event.httpMethod;
  const path = event.resource || '';
  if (method === 'POST' && path.endsWith('/deactivate')) return deactivateIncident(event);
  if (method === 'POST') return createIncident(event);
  if (method === 'GET') return getIncident(event);
  throw new HttpError(405, 'method_not_allowed', 'Unsupported method.');
});
