/**
 * Recommendation decision endpoint (tasks 5.1/5.2 — human approval workflow).
 *
 *   GET  /recommendations?status=pending
 *   POST /recommendations/{id}/decision  { decision, content?, note? }
 *
 * Only a charge nurse may decide. Approve / modify-approve create a Task and
 * write audit entries; reject marks the recommendation rejected and creates NO
 * task. A recommendation is never applied automatically — a human decision is
 * the only path from recommendation to task.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  getActor,
  HttpError,
  ok,
  parseBody,
  requireRole,
  withErrorHandling,
  type HttpResult,
} from '../lib/http.ts';
import {
  getItem,
  gsi1,
  keys,
  newId,
  putItem,
  queryGsi1,
  type StoredItem,
} from '../lib/dynamo.ts';
import { recordAudit } from '../lib/audit.ts';
import type {
  DecisionRequest,
  DecisionResponse,
  Recommendation,
  Task,
} from '../lib/types.ts';

function strip<T>(item: StoredItem): T {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item;
  return rest as T;
}

const listRecommendations = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    getActor(event);
    const status = event.queryStringParameters?.status ?? 'pending';
    const items = await queryGsi1<StoredItem>(`REC_STATUS#${status}`, true);
    return ok({ recommendations: items.map((i) => strip<Recommendation>(i)) });
  },
);

const decide = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    const actor = getActor(event);
    // Human approval boundary: only a charge nurse may decide.
    requireRole(actor, 'charge-nurse');

    const recId = event.pathParameters?.id;
    if (!recId) throw new HttpError(400, 'Path parameter "id" (recId) is required.');

    const body = parseBody<DecisionRequest>(event);
    const { decision } = body;
    if (
      decision !== 'approve' &&
      decision !== 'reject' &&
      decision !== 'modify-approve'
    ) {
      throw new HttpError(400, 'Field "decision" must be approve, reject, or modify-approve.');
    }
    if (decision === 'modify-approve' && (!body.content || !body.content.description?.trim())) {
      throw new HttpError(400, 'modify-approve requires content.description.');
    }

    const stored = await getItem<StoredItem & Recommendation>(keys.recommendation(recId));
    if (!stored) throw new HttpError(404, 'Recommendation not found.');
    const rec = strip<Recommendation>(stored);

    if (rec.status !== 'pending') {
      throw new HttpError(409, `Recommendation already ${rec.status}.`);
    }

    // --- Reject: no task created. ---
    if (decision === 'reject') {
      const rejected: Recommendation = { ...rec, status: 'rejected' };
      await putItem({
        ...keys.recommendation(recId),
        ...gsi1.recByStatus('rejected', rec.priorityRank, recId),
        ...rejected,
      });
      await recordAudit({
        actor,
        action: 'recommendation-rejected',
        targetId: recId,
        before: rec,
        after: rejected,
      });
      const res: DecisionResponse = { recommendation: rejected };
      return ok(res);
    }

    // --- Approve / modify-approve: create a task. ---
    const modified = decision === 'modify-approve' ? body.content : undefined;
    const approved: Recommendation = {
      ...rec,
      status: 'approved',
      modifiedContent: modified,
    };
    await putItem({
      ...keys.recommendation(recId),
      ...gsi1.recByStatus('approved', rec.priorityRank, recId),
      ...approved,
    });

    if (modified) {
      await recordAudit({
        actor,
        action: 'recommendation-modified',
        targetId: recId,
        before: rec.content,
        after: modified,
      });
    }
    await recordAudit({
      actor,
      action: 'recommendation-approved',
      targetId: recId,
      after: approved,
    });

    const applied = modified ?? rec.content;
    const taskId = newId();
    const nowIso = new Date().toISOString();
    const task: Task = {
      taskId,
      patientId: rec.patientId,
      assignee: applied.suggestedAssignee ?? 'Unassigned',
      description: applied.description,
      priority: rec.priority,
      status: 'open',
      recId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await putItem({
      ...keys.task(taskId),
      ...gsi1.taskByStatus('open', taskId),
      ...task,
    });
    await recordAudit({ actor, action: 'task-created', targetId: taskId, after: task });

    const res: DecisionResponse = { recommendation: approved, task };
    return ok(res);
  },
);

export const handler = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    const method = event.requestContext?.http?.method ?? 'GET';
    if (method === 'GET') return listRecommendations(event);
    if (method === 'POST') return decide(event);
    throw new HttpError(405, `Method ${method} not allowed on /recommendations.`);
  },
);
