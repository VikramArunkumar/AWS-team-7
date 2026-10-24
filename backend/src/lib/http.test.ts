import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import {
  getActor,
  HttpError,
  parseBody,
  requireRole,
  requireString,
} from './http.ts';

function eventWith(
  headers: Record<string, string> = {},
  body?: string,
): APIGatewayProxyEventV2 {
  return { headers, body } as unknown as APIGatewayProxyEventV2;
}

test('getActor returns identity from valid headers', () => {
  const actor = getActor(eventWith({ 'x-demo-role': 'nurse', 'x-demo-user': 'Alex' }));
  assert.deepEqual(actor, { role: 'nurse', name: 'Alex' });
});

test('getActor rejects a missing or invalid role with 401', () => {
  assert.throws(() => getActor(eventWith({ 'x-demo-user': 'Alex' })), (e) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.statusCode, 401);
    return true;
  });
  assert.throws(
    () => getActor(eventWith({ 'x-demo-role': 'doctor', 'x-demo-user': 'Alex' })),
    (e) => e instanceof HttpError && e.statusCode === 401,
  );
});

test('requireRole allows permitted role and blocks others with 403', () => {
  requireRole({ role: 'charge-nurse', name: 'Sam' }, 'charge-nurse'); // no throw
  assert.throws(
    () => requireRole({ role: 'nurse', name: 'Alex' }, 'charge-nurse'),
    (e) => e instanceof HttpError && e.statusCode === 403,
  );
});

test('parseBody parses JSON and rejects malformed/empty bodies with 400', () => {
  assert.deepEqual(parseBody(eventWith({}, '{"a":1}')), { a: 1 });
  assert.throws(
    () => parseBody(eventWith({}, 'not json')),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );
  assert.throws(
    () => parseBody(eventWith({})),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );
});

test('requireString enforces non-empty strings', () => {
  assert.equal(requireString('  hi  ', 'x'), 'hi');
  assert.throws(
    () => requireString('', 'x'),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );
  assert.throws(
    () => requireString(42, 'x'),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );
});
