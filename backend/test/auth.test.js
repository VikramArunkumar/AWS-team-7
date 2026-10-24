// Authentication: claim validation, role policy, identity mapping, and /me.
// Uses mocked authorizer claims (see helpers/setup.js); not a live Cognito test.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEST_ENV, SUBS, resetData, claimsFor, accessClaims, apiEvent, parse,
} from './helpers/setup.js';

const { handler: me } = await import('../src/handlers/me.js');
const { parseGroups, resolveRole } = await import('../src/lib/auth.js');
const { userKey } = await import('../src/lib/keys.js');

const callMe = (claims, headers) => me(apiEvent({ method: 'GET', resource: '/me', claims, headers })).then(parse);

describe('parseGroups handles API Gateway claim serialization', () => {
  const cases = [
    [undefined, []],
    [null, []],
    ['', []],
    ['[]', []],
    ['nurse', ['nurse']],
    ['charge_nurse', ['charge_nurse']],
    ['nurse,charge_nurse', ['nurse', 'charge_nurse']],
    ['[nurse charge_nurse]', ['nurse', 'charge_nurse']],
    ['[nurse]', ['nurse']],
    ['["nurse","charge_nurse"]', ['nurse', 'charge_nurse']],
    [['charge_nurse'], ['charge_nurse']],
    [' nurse , nurse ', ['nurse']],
  ];
  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(parseGroups(raw), expected);
    });
  }

  test('a non-string, non-array value can never resolve to a role', () => {
    assert.throws(() => resolveRole(parseGroups(42)), { code: 'role_unrecognized' });
  });
});

describe('resolveRole policy (fail closed)', () => {
  test('exactly one CareBridge group yields that role', () => {
    assert.equal(resolveRole(['nurse']), 'nurse');
    assert.equal(resolveRole(['charge_nurse']), 'charge_nurse');
  });
  test('no group is rejected', () => {
    assert.throws(() => resolveRole([]), { statusCode: 403, code: 'role_missing' });
  });
  test('both groups is a conflict, never an elevation', () => {
    assert.throws(() => resolveRole(['nurse', 'charge_nurse']), { statusCode: 403, code: 'role_conflict' });
  });
  test('an unrecognized group is rejected, even alongside a valid role', () => {
    assert.throws(() => resolveRole(['nurse', 'admins']), { statusCode: 403, code: 'role_unrecognized' });
    assert.throws(() => resolveRole(['Charge_Nurse']), { code: 'role_unrecognized' });
  });
});

describe('GET /me authentication', () => {
  beforeEach(() => { resetData(); });

  test('missing authorizer identity is denied with 401', async () => {
    const res = await callMe(undefined);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
  });

  test('header-only impersonation is denied with 401', async () => {
    const res = await callMe(undefined, {
      'X-User-Id': 'c1',
      'X-User-Role': 'charge_nurse',
      Authorization: 'Bearer not-a-verified-token',
    });
    assert.equal(res.status, 401);
  });

  test('forged identity headers cannot change a verified identity', async () => {
    const res = await callMe(claimsFor.sarah(), { 'X-User-Id': 'c1', 'X-User-Role': 'charge_nurse' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId: 'n1', displayName: 'Sarah Chen', role: 'nurse' });
  });

  test('an ID token is not accepted as an API access token', async () => {
    const res = await callMe(claimsFor.sarah({ token_use: 'id' }));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_token');
  });

  test('a token from a different app client is rejected', async () => {
    const res = await callMe(claimsFor.olivia({ client_id: 'someotherappclientid000000' }));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_token');
  });

  test('a token from a different user pool is rejected', async () => {
    const res = await callMe(claimsFor.olivia({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTHER' }));
    assert.equal(res.status, 401);
  });

  test('an access token without the CareBridge scope is rejected', async () => {
    const res = await callMe(claimsFor.olivia({ scope: 'openid aws.cognito.signin.user.admin' }));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'insufficient_scope');
  });

  test('a malformed sub is rejected', async () => {
    const res = await callMe(accessClaims('USER#c1', 'charge_nurse'));
    assert.equal(res.status, 401);
  });

  test('a valid but unmapped Cognito user cannot access application data', async () => {
    const res = await callMe(claimsFor.stranger());
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'not_provisioned');
  });

  test('a mapping whose profile is bound to a different sub is rejected', async () => {
    const fake = resetData();
    const profile = fake.get(userKey('n1'));
    fake.seed([{ ...profile, cognitoSub: SUBS.stranger }]);
    const res = await callMe(claimsFor.sarah());
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'not_provisioned');
  });

  test('a group that differs from the provisioned role is rejected (no elevation)', async () => {
    const res = await callMe(accessClaims(SUBS.sarah, 'charge_nurse'));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'role_mismatch');
  });

  for (const groups of ['nurse,charge_nurse', '[nurse charge_nurse]']) {
    test(`conflicting membership ${JSON.stringify(groups)} is rejected`, async () => {
      const res = await callMe(accessClaims(SUBS.olivia, groups));
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'role_conflict');
    });
  }

  test('a user with no CareBridge group is rejected', async () => {
    const res = await callMe(accessClaims(SUBS.sarah, undefined));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'role_missing');
  });

  test('a provisioned nurse gets only safe identity fields', async () => {
    const res = await callMe(claimsFor.sarah());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId: 'n1', displayName: 'Sarah Chen', role: 'nurse' });
    assert.ok(!JSON.stringify(res.body).includes(SUBS.sarah), 'the Cognito sub is not echoed');
  });

  test('a provisioned charge nurse maps to the seeded charge nurse id', async () => {
    const res = await callMe(claimsFor.olivia());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId: 'c1', displayName: 'Olivia Bennett', role: 'charge_nurse' });
  });

  test('missing auth configuration fails closed', async () => {
    const saved = process.env.COGNITO_APP_CLIENT_ID;
    delete process.env.COGNITO_APP_CLIENT_ID;
    try {
      const res = await callMe(claimsFor.olivia());
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'auth_misconfigured');
    } finally {
      process.env.COGNITO_APP_CLIENT_ID = saved;
    }
  });

  test('success and error responses carry the configured CORS origin and no-store', async () => {
    for (const res of [await callMe(claimsFor.sarah()), await callMe(undefined)]) {
      assert.equal(res.headers['Access-Control-Allow-Origin'], TEST_ENV.ALLOWED_ORIGIN);
      assert.equal(res.headers['Cache-Control'], 'no-store');
      assert.ok(!res.headers['Access-Control-Allow-Headers'].includes('X-User'), 'retired identity headers are not allowed');
    }
  });
});
