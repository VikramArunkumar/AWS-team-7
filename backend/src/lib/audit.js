// Append-only audit log (FR-41).
//
// Records who did what, to which record, and when, with enough context to
// reconstruct the action. Audit items share the incident partition and sort by
// timestamp. They are written, never updated, so history cannot be rewritten.
//
// Keep patient free-text and raw request bodies OUT of audit detail (NFR-11).
// Store identifiers and small status/field summaries instead.

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './ddb.js';
import { auditKey, ENTITY } from './keys.js';
import { nowIso, uuid } from './ids.js';

export const AUDIT_ACTIONS = {
  INCIDENT_ACTIVATED: 'incident.activated',
  INCIDENT_DEACTIVATED: 'incident.deactivated',
  PATIENT_UPDATED: 'patient.updated',
  UPDATE_CREATED: 'update.created',
  UPDATE_EDITED: 'update.edited',
  UPDATE_PROCESSED: 'update.processed',
  REC_APPROVED: 'recommendation.approved',
  REC_REJECTED: 'recommendation.rejected',
  TASK_CREATED: 'task.created',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_ASSIGNED: 'task.assigned',
  ESCALATION: 'escalation.raised',
};

/**
 * Build an audit item. Returned as a PutCommand-shaped Item so it can either be
 * written directly or folded into a TransactWriteItems batch.
 */
export function buildAuditItem(incidentId, { actorId, actorRole, action, targetId, summary }) {
  const ts = nowIso();
  return {
    ...auditKey(incidentId, ts, uuid()),
    entity: ENTITY.AUDIT,
    incidentId,
    actorId,
    actorRole,
    action,
    targetId: targetId ?? null,
    // summary is a small, non-sensitive object (ids, status transitions, counts).
    summary: summary ?? null,
    createdAt: ts,
  };
}

export async function writeAudit(incidentId, entry) {
  const item = buildAuditItem(incidentId, entry);
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}
