// Charge nurse dashboard read (FR-30, FR-31, FR-40).
//
// A single Query over the incident partition returns every record for the
// incident, which we group by entity and enrich with derived indicators
// (overdue, unconfirmed, unverified). One round trip supports the 3-second
// load target (NFR-4). Filtering/sorting (FR-31) is applied server-side when
// query-string params are present; the frontend can also refine client-side.
//
// Charge nurse only (NFR-8). The snapshot contains every patient, all tasks,
// staffing-related data, and AI recommendations for the incident. Signing in
// as a nurse does not grant this view; a nurse-scoped read endpoint is a
// documented remaining gap.

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import { incidentPk, ENTITY } from '../lib/keys.js';
import { authenticate, requireRole, ROLES } from '../lib/auth.js';
import { staffDirectory } from '../lib/staff.js';
import { ok, withErrorHandling, HttpError } from '../lib/http.js';
import {
  VERIFICATION_FRESHNESS_MINUTES, isUnverified, isOverdue, durationMinutes,
} from '../lib/indicators.js';

const OPEN_TASK_STATUSES = new Set(['Unconfirmed', 'In progress', 'Delayed', 'Unable to complete']);

async function getDashboard(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.CHARGE_NURSE);
  const { incidentId } = event.pathParameters || {};
  const q = event.queryStringParameters || {};
  const now = Date.now();

  // Pull the whole incident partition. Paginate defensively in case a long
  // incident exceeds a single 1MB page.
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

  const patients = items
    .filter((i) => i.entity === ENTITY.PATIENT)
    .map((p) => ({
      ...p,
      unverified: isUnverified(p.verifiedAt, now), // FR-11
    }));

  let tasks = items
    .filter((i) => i.entity === ENTITY.TASK)
    .map((t) => ({
      ...t,
      overdue: isOverdue(t, now),        // FR-39
      unconfirmed: t.status === 'Unconfirmed',
    }));

  let updates = items
    .filter((i) => i.entity === ENTITY.UPDATE)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const recommendations = items
    .filter((i) => i.entity === ENTITY.REC)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  // FR-31: optional server-side filtering by patient/nurse/status.
  if (q.patient) {
    tasks = tasks.filter((t) => t.patient === q.patient);
    updates = updates.filter((u) => u.patient === q.patient);
  }
  if (q.nurse) {
    tasks = tasks.filter((t) => t.nurse === q.nurse);
    updates = updates.filter((u) => u.nurse === q.nurse);
  }
  if (q.status) {
    tasks = tasks.filter((t) => t.status === q.status);
  }
  if (q.sort === 'urgency') {
    const rank = { High: 0, Moderate: 1, Low: 2 };
    tasks.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
  }

  // Summary tiles the dashboard surfaces up front (FR-30, NFR-18).
  const summary = {
    activePatients: patients.length,
    highRiskPatients: patients.filter((p) => p.priority === 'High').length,
    unverifiedPatients: patients.filter((p) => p.unverified).length,
    openTasks: tasks.filter((t) => OPEN_TASK_STATUSES.has(t.status)).length,
    overdueTasks: tasks.filter((t) => t.overdue).length,
    unconfirmedTasks: tasks.filter((t) => t.unconfirmed).length,
    urgentUpdates: updates.filter((u) => u.urgent).length,
    proposedRecommendations: recommendations.filter((r) => r.status === 'proposed').length,
  };

  // Display names for every nurse referenced in this incident, plus the
  // caller. Profiles live outside the incident partition, so they are looked
  // up by id; Cognito subs are never included.
  const staff = await staffDirectory([
    actor.userId,
    ...patients.map((p) => p.nurse),
    ...tasks.map((t) => t.nurse),
    ...updates.map((u) => u.nurse),
  ]);

  return ok({
    staff,
    incident: { ...incident, durationMinutes: durationMinutes(incident, now) }, // FR-7
    summary,
    patients,
    tasks,
    updates,
    recommendations,
    meta: { verificationFreshnessMinutes: VERIFICATION_FRESHNESS_MINUTES },
  });
}

export const handler = withErrorHandling(getDashboard);
