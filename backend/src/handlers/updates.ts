/**
 * Nurse update endpoints (task 2.5).
 *
 *   POST /updates?patientId=...  { patientId, text }  -> NurseUpdate (201)
 *   GET  /updates?patientId=...                        -> { updates: [] }
 *
 * A submitted update is persisted as an IMMUTABLE, write-once record. Nothing in
 * the system overwrites it; AI output is stored as separate records that
 * reference it by updateId (see process.ts).
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  getActor,
  HttpError,
  ok,
  parseBody,
  requireString,
  withErrorHandling,
  type HttpResult,
} from '../lib/http.ts';
import {
  keys,
  newId,
  putItemIfAbsent,
  queryByPrefix,
  type StoredItem,
} from '../lib/dynamo.ts';
import type { NurseUpdate, SubmitUpdateRequest } from '../lib/types.ts';

function strip(item: StoredItem): NurseUpdate {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item;
  return rest as unknown as NurseUpdate;
}

const postUpdate = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    const actor = getActor(event);
    const body = parseBody<SubmitUpdateRequest>(event);
    const patientId = requireString(body.patientId, 'patientId');
    const text = requireString(body.text, 'text');

    const updateId = newId();
    const update: NurseUpdate = {
      updateId,
      patientId,
      authorRole: actor.role,
      authorName: actor.name,
      text,
      createdAt: new Date().toISOString(),
    };

    // Write-once: fails if a record with this key already exists.
    await putItemIfAbsent({ ...keys.update(patientId, updateId), ...update });
    return ok(update, 201);
  },
);

const listUpdates = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    getActor(event); // any selected role may read
    const patientId = requireString(event.queryStringParameters?.patientId, 'patientId');
    const items = await queryByPrefix<StoredItem>(`PATIENT#${patientId}`, 'UPDATE#', true);
    return ok({ updates: items.map(strip) });
  },
);

export const handler = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    const method = event.requestContext?.http?.method ?? 'GET';
    if (method === 'POST') return postUpdate(event);
    if (method === 'GET') return listUpdates(event);
    throw new HttpError(405, `Method ${method} not allowed on /updates.`);
  },
);
