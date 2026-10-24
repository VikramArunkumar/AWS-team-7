// Server-controlled identity mapping: planning rules and transaction semantics.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEST_ENV, SUBS, resetData, claimsFor, accessClaims, apiEvent, parse,
} from './helpers/setup.js';

const { planIdentityBinding, planIdentityRemoval, ProvisioningError } = await import('../scripts/lib/provisioning.js');
const { handler: me } = await import('../src/handlers/me.js');
const { handler: tasks } = await import('../src/handlers/tasks.js');
const keys = await import('../src/lib/keys.js');

const tableName = TEST_ENV.TABLE_NAME;
const callMe = (claims) => me(apiEvent({ method: 'GET', resource: '/me', claims })).then(parse);
const bind = (overrides) => planIdentityBinding({
  tableName, provisionedBy: 'admin:test', now: '2026-10-23T12:00:00.000Z', ...overrides,
});

let fake;
beforeEach(() => { fake = resetData(); });

describe('planIdentityBinding validation', () => {
  const base = { cognitoSub: SUBS.stranger, appUserId: 'n3', role: 'nurse', cognitoGroups: ['nurse'] };

  test('rejects an unknown role', () => {
    assert.throws(() => bind({ ...base, role: 'admin' }), ProvisioningError);
  });
  test('rejects a malformed sub or app user id', () => {
    assert.throws(() => bind({ ...base, cognitoSub: 'not a sub' }), ProvisioningError);
    assert.throws(() => bind({ ...base, appUserId: 'USER#n3' }), ProvisioningError);
  });
  test('requires Cognito group membership to be exactly the requested role', () => {
    assert.throws(() => bind({ ...base, cognitoGroups: [] }), /exactly one group/);
    assert.throws(() => bind({ ...base, cognitoGroups: ['charge_nurse'] }), /exactly one group/);
    assert.throws(() => bind({ ...base, cognitoGroups: ['nurse', 'charge_nurse'] }), /exactly one group/);
  });
});

describe('binding transactions', () => {
  test('binding a new account to an existing seeded profile enables /me', async () => {
    assert.equal((await callMe(claimsFor.stranger())).status, 403);
    fake.transactWrite(bind({ cognitoSub: SUBS.stranger, appUserId: 'n3', role: 'nurse', cognitoGroups: ['nurse'] }));
    const res = await callMe(claimsFor.stranger());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId: 'n3', displayName: 'Maria Garcia', role: 'nurse' });
  });

  test('re-running the same binding is idempotent', async () => {
    fake.transactWrite(bind({ cognitoSub: SUBS.sarah, appUserId: 'n1', role: 'nurse', cognitoGroups: ['nurse'] }));
    assert.equal((await callMe(claimsFor.sarah())).status, 200);
  });

  test('a second Cognito account cannot be bound to an already-bound user', async () => {
    assert.throws(
      () => fake.transactWrite(bind({ cognitoSub: SUBS.stranger, appUserId: 'n1', role: 'nurse' })),
      (err) => err.name === 'TransactionCanceledException' && err.CancellationReasons[1].Code === 'ConditionalCheckFailed',
    );
    assert.equal(fake.get(keys.identityKey(SUBS.stranger)), undefined, 'the transaction wrote nothing');
    assert.equal((await callMe(claimsFor.stranger())).status, 403);
  });

  test('an existing mapping cannot be re-pointed to another user', () => {
    assert.throws(
      () => fake.transactWrite(bind({ cognitoSub: SUBS.sarah, appUserId: 'n2', role: 'nurse' })),
      (err) => err.CancellationReasons[0].Code === 'ConditionalCheckFailed',
    );
    assert.equal(fake.get(keys.identityKey(SUBS.sarah)).userId, 'n1');
  });

  test('a profile role cannot change implicitly', async () => {
    assert.throws(
      () => fake.transactWrite(bind({ cognitoSub: SUBS.sarah, appUserId: 'n1', role: 'charge_nurse' })),
      { name: 'TransactionCanceledException' },
    );
    fake.transactWrite(bind({ cognitoSub: SUBS.sarah, appUserId: 'n1', role: 'charge_nurse', allowRoleChange: true }));
    // After an explicit role change, the old group no longer matches.
    assert.equal((await callMe(claimsFor.sarah())).body.error.code, 'role_mismatch');
    assert.equal((await callMe(accessClaims(SUBS.sarah, 'charge_nurse'))).body.role, 'charge_nurse');
  });
});

describe('removing a binding', () => {
  test('blocks an otherwise valid token immediately and keeps seeded ownership', async () => {
    fake.transactWrite(planIdentityRemoval({ tableName, cognitoSub: SUBS.sarah, appUserId: 'n1' }));

    const res = await callMe(claimsFor.sarah());
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'not_provisioned');

    const patch = await tasks(apiEvent({
      method: 'PATCH', resource: '/incidents/{incidentId}/tasks/{taskId}', claims: claimsFor.sarah(),
      pathParameters: { incidentId: 'INC-0042', taskId: 'TSK-201' }, body: { status: 'Completed' },
    })).then(parse);
    assert.equal(patch.status, 403);

    assert.equal(fake.get(keys.userKey('n1')).cognitoSub, undefined);
    assert.equal(fake.get(keys.taskKey('INC-0042', 'TSK-201')).nurse, 'n1');
  });

  test('refuses when the mapping points at a different user', () => {
    assert.throws(
      () => fake.transactWrite(planIdentityRemoval({ tableName, cognitoSub: SUBS.sarah, appUserId: 'n2' })),
      { name: 'TransactionCanceledException' },
    );
    assert.equal(fake.get(keys.identityKey(SUBS.sarah)).userId, 'n1');
  });
});
