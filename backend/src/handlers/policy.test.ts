import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { handler } from './policy.ts';
import type { PolicyAnswer } from '../lib/types.ts';

beforeEach(() => {
  process.env.POLICY_MOCK = '1';
});

function event(headers: Record<string, string>, body?: unknown): APIGatewayProxyEventV2 {
  return {
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

const AUTH = { 'x-demo-role': 'nurse', 'x-demo-user': 'Alex' };

test('answers a known policy question with support + citation', async () => {
  const res = await handler(event(AUTH, { question: 'EHR outage steps?' }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body as string) as PolicyAnswer;
  assert.equal(body.hasSupport, true);
  assert.ok(body.citations.length >= 1);
});

test('unknown topic returns no-policy with a recommendation', async () => {
  const res = await handler(event(AUTH, { question: 'who won the game last night?' }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body as string) as PolicyAnswer;
  assert.equal(body.hasSupport, false);
  assert.ok(body.recommendation && body.recommendation.length > 0);
});

test('requires a selected role (401 without headers)', async () => {
  const res = await handler(event({}, { question: 'EHR outage steps?' }));
  assert.equal(res.statusCode, 401);
});

test('rejects a missing question with 400', async () => {
  const res = await handler(event(AUTH, {}));
  assert.equal(res.statusCode, 400);
});
