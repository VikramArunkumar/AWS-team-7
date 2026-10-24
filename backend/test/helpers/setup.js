// Shared test setup: environment, the in-memory DynamoDB double, seeded
// synthetic fixtures, provisioned identities, and API Gateway event builders.
//
// These tests use MOCKED authorizer claims. They prove how Lambda treats the
// claims API Gateway hands it; they do not prove that the deployed Cognito
// authorizer verifies tokens. See backend/README.md for the live smoke test.

export const TEST_ENV = Object.freeze({
  TABLE_NAME: 'CareBridge-test',
  COGNITO_APP_CLIENT_ID: '1example23456789abcdefghij',
  COGNITO_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL',
  AUTH_REQUIRED_SCOPE: 'carebridge/access',
  ALLOWED_ORIGIN: 'http://localhost:5173',
});
Object.assign(process.env, TEST_ENV);

// Imports below depend on the environment above.
const { ddb } = await import('../../src/lib/ddb.js');
const { createFakeDdb } = await import('./fake-ddb.js');
const { buildSeedItems } = await import('../../scripts/lib/seed-items.js');
const { planIdentityBinding } = await import('../../scripts/lib/provisioning.js');
const fixtures = await import('../../../src/data.js');

export { fixtures };
export const INCIDENT_ID = fixtures.incident.id;

// Synthetic Cognito subs (UUID-shaped) for provisioned and unprovisioned users.
export const SUBS = Object.freeze({
  sarah: '11111111-1111-4111-8111-111111111111',   // -> n1, nurse
  james: '22222222-2222-4222-8222-222222222222',   // -> n2, nurse
  olivia: '33333333-3333-4333-8333-333333333333',  // -> c1, charge_nurse
  stranger: '44444444-4444-4444-8444-444444444444', // valid token, no mapping
});

export const IDENTITIES = Object.freeze([
  { sub: SUBS.sarah, appUserId: 'n1', role: 'nurse' },
  { sub: SUBS.james, appUserId: 'n2', role: 'nurse' },
  { sub: SUBS.olivia, appUserId: 'c1', role: 'charge_nurse' },
]);

/** Fresh fake table with fixtures seeded and the three identities bound. */
export function resetData() {
  const fake = createFakeDdb();
  const { incidentItems, profileItems } = buildSeedItems(fixtures, { now: '2026-10-23T12:00:00.000Z' });
  fake.seed([...incidentItems, ...profileItems]);
  for (const { sub, appUserId, role } of IDENTITIES) {
    fake.transactWrite(planIdentityBinding({
      tableName: TEST_ENV.TABLE_NAME,
      cognitoSub: sub,
      appUserId,
      role,
      cognitoGroups: [role],
      provisionedBy: 'admin:test',
      now: '2026-10-23T12:00:00.000Z',
    }));
  }
  ddb.send = fake.send;
  return fake;
}

/** Claims shaped like a REST API Cognito authorizer delivers for an access token. */
export function accessClaims(sub, groups, overrides = {}) {
  return {
    sub,
    'cognito:groups': groups,
    iss: TEST_ENV.COGNITO_ISSUER,
    client_id: TEST_ENV.COGNITO_APP_CLIENT_ID,
    token_use: 'access',
    scope: 'openid carebridge/access',
    username: sub,
    auth_time: '1792756800',
    exp: 'Fri Oct 23 13:00:00 UTC 2026',
    iat: 'Fri Oct 23 12:30:00 UTC 2026',
    jti: 'abcd-efgh',
    ...overrides,
  };
}

export const claimsFor = {
  sarah: (o) => accessClaims(SUBS.sarah, 'nurse', o),
  james: (o) => accessClaims(SUBS.james, 'nurse', o),
  olivia: (o) => accessClaims(SUBS.olivia, 'charge_nurse', o),
  stranger: (o) => accessClaims(SUBS.stranger, 'nurse', o),
};

/** Build a REST API (Lambda proxy) event. Omit claims to model "no authorizer context". */
export function apiEvent({
  method = 'GET', resource, pathParameters = {}, claims, headers = {}, body, query,
} = {}) {
  return {
    httpMethod: method,
    resource,
    path: resource,
    pathParameters,
    headers,
    queryStringParameters: query ?? null,
    body: body === undefined ? null : JSON.stringify(body),
    requestContext: claims ? { authorizer: { claims } } : {},
  };
}

export function parse(res) {
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
}
