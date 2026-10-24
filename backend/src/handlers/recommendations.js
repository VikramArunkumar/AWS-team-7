// AI recommendation decisions (FR-33, NFR-24, NFR-25).
//
// This is the ONLY path that turns an AI proposal into a real action. Approval
// and task creation happen together in a single TransactWriteItems so a
// recommendation cannot be approved without its resulting task being recorded,
// and neither can be applied twice (idempotency via a condition on status).
//
// Rejection applies no proposed action — it only flips status and audits.
// Enforcement lives here in the backend; a UI confirmation is not sufficient
// (AGENTS.md: enforce approval in the backend action path).

import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import {
  recommendationKey, taskKey, ENTITY, taskGsi1,
} from '../lib/keys.js';
import { newTaskId, nowIso } from '../lib/ids.js';
import { buildAuditItem, AUDIT_ACTIONS } from '../lib/audit.js';
import { authenticate, requireRole, ROLES } from '../lib/auth.js';
import {
  ok, created, withErrorHandling, parseBody, HttpError,
} from '../lib/http.js';

async function loadProposed(incidentId, recId) {
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: recommendationKey(incidentId, recId),
  }));
  if (!res.Item) throw new HttpError(404, 'not_found', 'Recommendation not found.');
  if (res.Item.status !== 'proposed') {
    throw new HttpError(409, 'already_decided', `Recommendation already ${res.Item.status}.`);
  }
  return res.Item;
}

// FR-33 / NFR-24: approving creates the assignment. Charge-nurse only.
// The body may modify the proposal before it becomes a task (NFR-25).
async function approve(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.CHARGE_NURSE);
  const { incidentId, recommendationId } = event.pathParameters || {};
  const body = parseBody(event);

  const rec = await loadProposed(incidentId, recommendationId);

  const taskId = newTaskId();
  const createdAt = nowIso();
  const nurse = body.assignedNurse ?? null; // charge nurse assigns (FR-34)
  const task = {
    ...taskKey(incidentId, taskId),
    ...(nurse ? taskGsi1(incidentId, nurse, taskId) : {}),
    entity: ENTITY.TASK,
    incidentId,
    id: taskId,
    patient: rec.patient,
    description: body.description ?? rec.title, // FR-37 fields
    priority: body.priority ?? 'Moderate',
    nurse,
    dueAt: body.dueAt ?? null,
    status: 'Unconfirmed',
    creator: actor.userId,
    createdAt,
    fromRecommendation: rec.id,   // trace task back to its AI source
    sourceUpdateIds: rec.sourceUpdateIds,
  };

  const ts = nowIso();
  try {
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          // Flip the recommendation to approved, but only if still 'proposed'.
          // This condition makes a double-approve a no-op (no duplicate task).
          Update: {
            TableName: TABLE_NAME,
            Key: recommendationKey(incidentId, recommendationId),
            ConditionExpression: '#s = :proposed',
            UpdateExpression: 'SET #s = :approved, decidedBy = :by, decidedAt = :at, resultingTaskId = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':proposed': 'proposed', ':approved': 'approved',
              ':by': actor.userId, ':at': ts, ':task': taskId,
            },
          },
        },
        { Put: { TableName: TABLE_NAME, Item: task } },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: buildAuditItem(incidentId, {
              actor,
              action: AUDIT_ACTIONS.REC_APPROVED, targetId: recommendationId,
              summary: { taskId, assignedNurse: nurse },
            }),
          },
        },
      ],
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      throw new HttpError(409, 'already_decided', 'Recommendation was already decided.');
    }
    throw err;
  }

  return created({ recommendationId, status: 'approved', task });
}

// NFR-25: rejection records the decision and applies nothing.
async function reject(event) {
  const actor = await authenticate(event);
  requireRole(actor, ROLES.CHARGE_NURSE);
  const { incidentId, recommendationId } = event.pathParameters || {};
  const body = parseBody(event);

  await loadProposed(incidentId, recommendationId);
  const ts = nowIso();

  try {
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: recommendationKey(incidentId, recommendationId),
            ConditionExpression: '#s = :proposed',
            UpdateExpression: 'SET #s = :rejected, decidedBy = :by, decidedAt = :at, rejectReason = :reason',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':proposed': 'proposed', ':rejected': 'rejected',
              ':by': actor.userId, ':at': ts, ':reason': body.reason ?? null,
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: buildAuditItem(incidentId, {
              actor,
              action: AUDIT_ACTIONS.REC_REJECTED, targetId: recommendationId,
            }),
          },
        },
      ],
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      throw new HttpError(409, 'already_decided', 'Recommendation was already decided.');
    }
    throw err;
  }

  return ok({ recommendationId, status: 'rejected' });
}

export const handler = withErrorHandling(async (event) => {
  const path = event.resource || '';
  if (event.httpMethod === 'POST' && path.endsWith('/approve')) return approve(event);
  if (event.httpMethod === 'POST' && path.endsWith('/reject')) return reject(event);
  throw new HttpError(405, 'method_not_allowed', 'Unsupported method.');
});
