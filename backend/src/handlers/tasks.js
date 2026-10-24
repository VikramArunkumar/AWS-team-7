// Task management (FR-36 to FR-40).
//
// Charge nurses create and assign/reassign tasks. Nurses report their own
// assigned work as completed, delayed, or unable to complete. Status
// transitions and assignment changes are audited and update what the dashboard
// reads (FR-40).

import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/ddb.js';
import { taskKey, taskGsi1, ENTITY } from '../lib/keys.js';
import { newTaskId, nowIso } from '../lib/ids.js';
import { writeAudit, AUDIT_ACTIONS } from '../lib/audit.js';
import {
  ok, created, withErrorHandling, parseBody, getActor, requireRole, ROLES, HttpError,
} from '../lib/http.js';

const PRIORITIES = ['High', 'Moderate', 'Low'];
// Status transitions nurses may self-report on their assigned work (FR-38).
const NURSE_STATUSES = ['In progress', 'Completed', 'Delayed', 'Unable to complete'];

// FR-36 / FR-37: charge nurse creates a task with the required fields.
async function createTask(event) {
  const actor = getActor(event);
  requireRole(actor, ROLES.CHARGE_NURSE);
  const { incidentId } = event.pathParameters || {};
  const body = parseBody(event);

  if (!body.patient) throw new HttpError(400, 'missing_patient', 'A patient is required.');
  if (!body.description) throw new HttpError(400, 'missing_description', 'A description is required.');
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'Moderate';

  const taskId = newTaskId();
  const createdAt = nowIso();
  const nurse = body.assignedNurse ?? null;
  const item = {
    ...taskKey(incidentId, taskId),
    ...(nurse ? taskGsi1(incidentId, nurse, taskId) : {}),
    entity: ENTITY.TASK,
    incidentId,
    id: taskId,
    patient: body.patient,
    description: body.description,
    priority,
    nurse,
    dueAt: body.dueAt ?? null,
    status: 'Unconfirmed',
    creator: actor.userId, // FR-37
    createdAt,
  };

  await ddb.send(new PutCommand({
    TableName: TABLE_NAME, Item: item,
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  }));

  await writeAudit(incidentId, {
    actorId: actor.userId, actorRole: actor.role,
    action: AUDIT_ACTIONS.TASK_CREATED, targetId: taskId,
    summary: { patient: body.patient, assignedNurse: nurse, priority },
  });

  return created(item);
}

// FR-38 / FR-34: a nurse may change status on their OWN task; a charge nurse may
// change status and reassign any task. A PATCH can carry status, assignedNurse,
// priority, or dueAt.
async function patchTask(event) {
  const actor = getActor(event);
  const { incidentId, taskId } = event.pathParameters || {};
  const body = parseBody(event);

  const existing = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: taskKey(incidentId, taskId),
  }));
  if (!existing.Item) throw new HttpError(404, 'not_found', 'Task not found.');
  const task = existing.Item;

  const isCharge = actor.role === ROLES.CHARGE_NURSE;
  const isOwner = task.nurse === actor.userId;

  // Reassignment / priority / due changes are charge-nurse only.
  const wantsReassign = body.assignedNurse !== undefined && body.assignedNurse !== task.nurse;
  const wantsPriority = body.priority !== undefined;
  const wantsDue = body.dueAt !== undefined;
  if ((wantsReassign || wantsPriority || wantsDue) && !isCharge) {
    throw new HttpError(403, 'forbidden', 'Only a charge nurse can reassign or reprioritize tasks.');
  }

  // Status change: charge nurse anytime, or the assigned nurse on their own task.
  if (body.status !== undefined) {
    if (!NURSE_STATUSES.includes(body.status)) {
      throw new HttpError(400, 'invalid_status', 'Unknown task status.');
    }
    if (!isCharge && !isOwner) {
      throw new HttpError(403, 'forbidden', 'You can only update tasks assigned to you.');
    }
  }

  const sets = [];
  const names = {};
  const values = {};
  const audit = {};

  if (body.status !== undefined) {
    sets.push('#s = :status');
    names['#s'] = 'status';
    values[':status'] = body.status;
    audit.status = body.status;
  }
  if (wantsReassign) {
    sets.push('nurse = :nurse', 'GSI1PK = :gpk', 'GSI1SK = :gsk');
    values[':nurse'] = body.assignedNurse;
    const gsi = taskGsi1(incidentId, body.assignedNurse, taskId);
    values[':gpk'] = gsi.GSI1PK;
    values[':gsk'] = gsi.GSI1SK;
    audit.assignedNurse = body.assignedNurse;
  }
  if (wantsPriority) {
    if (!PRIORITIES.includes(body.priority)) {
      throw new HttpError(400, 'invalid_priority', 'Unknown priority.');
    }
    sets.push('priority = :priority');
    values[':priority'] = body.priority;
    audit.priority = body.priority;
  }
  if (wantsDue) {
    sets.push('dueAt = :dueAt');
    values[':dueAt'] = body.dueAt;
    audit.dueAt = body.dueAt;
  }
  if (sets.length === 0) {
    throw new HttpError(400, 'nothing_to_update', 'No supported fields provided.');
  }

  const res = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: taskKey(incidentId, taskId),
    ConditionExpression: 'attribute_exists(PK)',
    UpdateExpression: `SET ${sets.join(', ')}`,
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));

  await writeAudit(incidentId, {
    actorId: actor.userId, actorRole: actor.role,
    action: wantsReassign ? AUDIT_ACTIONS.TASK_ASSIGNED : AUDIT_ACTIONS.TASK_STATUS_CHANGED,
    targetId: taskId, summary: audit,
  });

  return ok(res.Attributes);
}

export const handler = withErrorHandling(async (event) => {
  const method = event.httpMethod;
  if (method === 'POST') return createTask(event);
  if (method === 'PATCH') return patchTask(event);
  throw new HttpError(405, 'method_not_allowed', 'Unsupported method.');
});
