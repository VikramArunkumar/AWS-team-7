import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import { setClient } from '../lib/dynamo.ts';
import { handler } from './outage.ts';

/**
 * Minimal in-memory fake of the DynamoDB Document client. Supports the three
 * command types the outage path uses: Get (read state), Put (write state +
 * audit), Query (not exercised here but handled for completeness).
 */
class FakeDocClient {
  store = new Map<string, Record<string, unknown>>();
  puts: Record<string, unknown>[] = [];

  private keyOf(item: Record<string, unknown>): string {
    return `${String(item.PK)}|${String(item.SK)}`;
  }

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      this.puts.push(item);
      this.store.set(this.keyOf(item), item);
      return {};
    }
    if (command instanceof GetCommand) {
      const key = command.input.Key as Record<string, unknown>;
      return { Item: this.store.get(this.keyOf(key)) };
    }
    if (command instanceof QueryCommand) {
      return { Items: [] };
    }
    throw new Error('Unexpected command in fake client');
  }
}

let fake: FakeDocClient;

beforeEach(() => {
  fake = new FakeDocClient();
  setClient(fake as unknown as Parameters<typeof setClient>[0]);
});

function event(
  method: string,
  headers: Record<string, string> = {},
  body?: unknown,
): APIGatewayProxyEventV2 {
  return {
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

test('GET /outage defaults to normal when never activated', async () => {
  const res = await handler(event('GET'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body as string), { status: 'normal' });
});

test('POST /outage activate requires charge-nurse role (403 for nurse)', async () => {
  const res = await handler(
    event('POST', { 'x-demo-role': 'nurse', 'x-demo-user': 'Alex' }, { action: 'activate' }),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(fake.puts.length, 0, 'nothing should be written on an unauthorized call');
});

test('POST /outage activate sets active, audits, and reads back', async () => {
  const headers = { 'x-demo-role': 'charge-nurse', 'x-demo-user': 'Sam' };
  const res = await handler(event('POST', headers, { action: 'activate', note: 'EHR down' }));
  assert.equal(res.statusCode, 200);

  const body = JSON.parse(res.body as string);
  assert.equal(body.status, 'active');
  assert.ok(body.startedAt, 'startedAt should be set');
  assert.equal(body.actor, 'Sam');

  // One write for the state, one for the audit entry.
  const auditWrites = fake.puts.filter((p) => p.PK === 'AUDIT');
  const stateWrites = fake.puts.filter((p) => p.PK === 'OUTAGE');
  assert.equal(stateWrites.length, 1);
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0]?.action, 'outage-activated');

  // GET reflects the new state.
  const getRes = await handler(event('GET'));
  assert.equal(JSON.parse(getRes.body as string).status, 'active');
});

test('POST /outage deactivate marks resolved with endedAt', async () => {
  const headers = { 'x-demo-role': 'charge-nurse', 'x-demo-user': 'Sam' };
  await handler(event('POST', headers, { action: 'activate' }));
  const res = await handler(event('POST', headers, { action: 'deactivate' }));
  const body = JSON.parse(res.body as string);
  assert.equal(body.status, 'resolved');
  assert.ok(body.endedAt, 'endedAt should be set');
});

test('POST /outage rejects an invalid action with 400', async () => {
  const headers = { 'x-demo-role': 'charge-nurse', 'x-demo-user': 'Sam' };
  const res = await handler(event('POST', headers, { action: 'explode' }));
  assert.equal(res.statusCode, 400);
});
