/**
 * Outage endpoints (task 2.3).
 *
 *   GET  /outage  -> read current outage state (any role)
 *   POST /outage  -> activate/deactivate (charge-nurse only)
 *
 * State changes are audited. The default state (never activated) is `normal`.
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
import { getItem, keys, putItem, type StoredItem } from '../lib/dynamo.ts';
import { recordAudit } from '../lib/audit.ts';
import type { OutageActionRequest, OutageState } from '../lib/types.ts';

const DEFAULT_STATE: OutageState = { status: 'normal' };

async function readState(): Promise<OutageState> {
  const item = await getItem<StoredItem & OutageState>(keys.outage());
  if (!item) return { ...DEFAULT_STATE };
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...state } = item;
  return state as OutageState;
}

async function writeState(state: OutageState): Promise<void> {
  const item: StoredItem = { ...keys.outage(), ...state };
  await putItem(item);
}

const getOutage = withErrorHandling(async (): Promise<HttpResult> => {
  const state = await readState();
  return ok(state);
});

const postOutage = withErrorHandling(async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
  const actor = getActor(event);
  requireRole(actor, 'charge-nurse');

  const body = parseBody<OutageActionRequest>(event);
  if (body.action !== 'activate' && body.action !== 'deactivate') {
    throw new HttpError(400, 'Field "action" must be "activate" or "deactivate".');
  }

  const now = new Date().toISOString();

  let next: OutageState;
  if (body.action === 'activate') {
    next = {
      status: 'active',
      startedAt: now,
      actor: actor.name,
      incidentType: body.incidentType,
      affectedSystems: body.affectedSystems,
      note: body.note,
    };
  } else {
    const current = await readState();
    next = {
      ...current,
      status: 'resolved',
      endedAt: now,
      actor: actor.name,
    };
  }

  await writeState(next);
  await recordAudit({
    actor,
    action: body.action === 'activate' ? 'outage-activated' : 'outage-deactivated',
    targetId: 'OUTAGE',
    after: next,
  });

  return ok(next);
});

/** Route dispatch for the outage resource. */
export const handler = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    const method = event.requestContext?.http?.method ?? 'GET';
    if (method === 'GET') return getOutage(event);
    if (method === 'POST') return postOutage(event);
    throw new HttpError(405, `Method ${method} not allowed on /outage.`);
  },
);
