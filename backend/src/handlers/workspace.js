// Nurse workspace read (FR-13, FR-38, FR-39, FR-11).
//
// GET /incidents/{incidentId}/workspace returns only what the signed-in nurse
// needs for their shift:
//   - patients assigned to them (plus any patient referenced by one of their
//     tasks, so a task never points at a patient the nurse cannot see)
//   - tasks assigned to them, with overdue / unconfirmed indicators
//   - updates they authored, newest first, with correction history
//   - incident status and elapsed duration
//
// Other nurses' updates and tasks, AI recommendations, staffing data, and the
// audit log are never included. The charge nurse uses the dashboard instead.
// The nurse is always the authenticated application user; there is no
// parameter to read another nurse's workspace.

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import { incidentPk, ENTITY } from '../lib/keys.js';
import { authenticate, requireRole, ROLES } from '../lib/auth.js';
import { ok, withErrorHandling, HttpError } from '../lib/http.js';
import {
  VERIFICATION_FRESHNESS_MINUTES, isUnverified, isOverdue, durationMinutes,
} from '../lib/indicators.js';

const INCIDENT_FIELDS = ['incidentId', 'type', 'unit', 'status', 'startedAt', 'endedAt'];

async function getWorkspace(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.NURSE);
  const { incidentId } = event.pathParameters || {};
  const now = Date.now();

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

  const incident = items.find((i) => i.entity === ENTITY.INCIDENT);
  if (!incident) throw new HttpError(404, 'not_found', 'Incident not found.');

  const tasks = items
    .filter((i) => i.entity === ENTITY.TASK && i.nurse === actor.userId)
    .map((t) => ({
      ...strip(t),
      overdue: isOverdue(t, now),
      unconfirmed: t.status === 'Unconfirmed',
    }));

  const taskPatients = new Set(tasks.map((t) => t.patient));
  const patients = items
    .filter((i) => i.entity === ENTITY.PATIENT && (i.nurse === actor.userId || taskPatients.has(i.id)))
    .map((p) => ({
      ...strip(p),
      assignedToMe: p.nurse === actor.userId,
      unverified: isUnverified(p.verifiedAt, now),
    }));

  const updates = items
    .filter((i) => i.entity === ENTITY.UPDATE && i.nurse === actor.userId)
    .map(strip)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const incidentView = Object.fromEntries(INCIDENT_FIELDS.map((k) => [k, incident[k] ?? null]));

  return ok({
    incident: { ...incidentView, durationMinutes: durationMinutes(incident, now) },
    nurse: { userId: actor.userId, displayName: actor.displayName },
    patients,
    tasks,
    updates,
    meta: { verificationFreshnessMinutes: VERIFICATION_FRESHNESS_MINUTES },
  });
}

// Table keys are storage details, not part of the API response.
function strip(item) {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  return rest;
}

export const handler = withErrorHandling(getWorkspace);
