// Authentication and role authorization (FR-1, FR-2, FR-3, NFR-8).
//
// Trust boundary
// --------------
// Every application route sits behind API Gateway's COGNITO_USER_POOLS
// authorizer (template.yaml). API Gateway verifies the JWT signature against
// the user pool, its expiry, and the required OAuth scope before invoking
// Lambda, then places the verified claims in
// event.requestContext.authorizer.claims. That object is the ONLY identity
// source used here.
//
// This module never reads the Authorization header, never decodes a JWT
// itself, and ignores identity or role hints in headers, query strings, or
// bodies (e.g. the retired X-User-Id / X-User-Role headers). There is no
// environment flag that disables these checks.
//
// On top of API Gateway's verification, Lambda re-checks the claims that the
// Cognito authorizer does not enforce for us:
//   - token_use must be "access" (an ID token must not act as an API token)
//   - client_id must be this app's SPA client (the authorizer accepts tokens
//     from any app client in the pool)
//   - iss must be this user pool
//   - scope must include the API scope
//
// Roles come from cognito:groups. Exactly one CareBridge role group is
// required; see resolveRole() for the conflict policy.
//
// Identity mapping
// ----------------
// The verified Cognito sub is mapped to an application user id (n1, c1, ...)
// through a server-side IDENTITY#<sub> item that only an administrator can
// write (scripts/provision-identity.js). The USER#<id> profile must point back
// at the same sub and record the same role, so a mapping cannot silently bind
// two Cognito accounts to one application user or grant a role the profile
// was not provisioned for.

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './ddb.js';
import { identityKey, userKey } from './keys.js';
import { HttpError } from './http.js';

export const ROLES = Object.freeze({ NURSE: 'nurse', CHARGE_NURSE: 'charge_nurse' });
const ROLE_GROUPS = new Set(Object.values(ROLES));

export const DEFAULT_REQUIRED_SCOPE = 'carebridge/access';

// Cognito subs are UUIDs. Be strict so unexpected values never reach a key.
const SUB_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

function authSettings() {
  const clientId = process.env.COGNITO_APP_CLIENT_ID;
  const issuer = process.env.COGNITO_ISSUER;
  const scope = process.env.AUTH_REQUIRED_SCOPE || DEFAULT_REQUIRED_SCOPE;
  if (!clientId || !issuer) {
    // Fail closed: a missing configuration must never mean "skip the checks".
    console.error('auth_misconfigured');
    throw new HttpError(500, 'auth_misconfigured', 'Sign-in is not configured for this service.');
  }
  return { clientId, issuer, scope };
}

/**
 * Return the claims API Gateway verified, or throw 401.
 * Headers are intentionally not consulted.
 */
export function getVerifiedClaims(event) {
  const claims = event?.requestContext?.authorizer?.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return claims;
}

/**
 * Parse cognito:groups as API Gateway delivers it.
 *
 * REST API Cognito authorizers flatten every claim to a string, so a
 * multi-group membership can arrive as "a,b", "[a b]", or a JSON array string
 * depending on the integration path. A real array is accepted too.
 * Group names cannot contain whitespace, and any token that is not an exact
 * CareBridge role is rejected by resolveRole(), so splitting cannot elevate.
 */
export function parseGroups(raw) {
  if (raw === undefined || raw === null) return [];
  let tokens;
  if (Array.isArray(raw)) {
    tokens = raw.map(String);
  } else if (typeof raw === 'string') {
    let text = raw.trim();
    if (!text) return [];
    let parsedArray = null;
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) parsedArray = parsed.map(String);
      } catch {
        // Not JSON; fall through to the bracketed, space/comma-separated form.
      }
      if (!parsedArray) text = text.slice(1, -1);
    }
    tokens = parsedArray ?? text.split(/[\s,]+/);
  } else {
    // Unexpected type: produce a token that can never match a role.
    return ['<unparseable>'];
  }
  return dedupe(tokens.map((t) => t.trim()).filter(Boolean));
}

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * Role policy (fail closed):
 *   - exactly one of nurse / charge_nurse        -> that role
 *   - no CareBridge role group                   -> 403 role_missing
 *   - both nurse and charge_nurse                -> 403 role_conflict
 *   - any group that is not a CareBridge role    -> 403 role_unrecognized
 * The pool is dedicated to CareBridge, so an unexpected group indicates a
 * configuration error that an administrator should resolve, not a role to
 * guess at. Higher privilege is never chosen automatically.
 */
export function resolveRole(groups) {
  const unrecognized = groups.filter((g) => !ROLE_GROUPS.has(g));
  if (unrecognized.length > 0) {
    throw new HttpError(403, 'role_unrecognized',
      'Your account has a group CareBridge does not recognize. Ask an administrator to fix your role.');
  }
  if (groups.length === 0) {
    throw new HttpError(403, 'role_missing',
      'Your account has no CareBridge role. Ask an administrator to assign one.');
  }
  if (groups.length > 1) {
    throw new HttpError(403, 'role_conflict',
      'Your account has more than one CareBridge role. Ask an administrator to keep only one.');
  }
  return groups[0];
}

/**
 * Check the verified claims belong to an access token for this app and API.
 * Returns { sub, groups }.
 */
export function validateClaims(claims, settings) {
  if (claims.token_use !== 'access') {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
  if (claims.client_id !== settings.clientId) {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
  if (claims.iss !== settings.issuer) {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(settings.scope)) {
    throw new HttpError(403, 'insufficient_scope', 'This sign-in does not grant access to CareBridge.');
  }
  const sub = claims.sub;
  if (typeof sub !== 'string' || !SUB_PATTERN.test(sub)) {
    throw new HttpError(401, 'invalid_token', 'Sign in again to continue.');
  }
  return { sub, groups: parseGroups(claims['cognito:groups']) };
}

const NOT_PROVISIONED = () => new HttpError(403, 'not_provisioned',
  'Your account is not set up for CareBridge yet. Ask an administrator to finish setup.');

async function loadProvisionedProfile(sub) {
  const mapping = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: identityKey(sub), ConsistentRead: true,
  }));
  const userId = mapping.Item?.userId;
  if (typeof userId !== 'string' || !userId) throw NOT_PROVISIONED();

  const profileRes = await ddb.send(new GetCommand({
    TableName: TABLE_NAME, Key: userKey(userId), ConsistentRead: true,
  }));
  const profile = profileRes.Item;
  // The binding must agree in both directions.
  if (!profile || profile.userId !== userId || profile.cognitoSub !== sub) throw NOT_PROVISIONED();
  return profile;
}

/**
 * Authenticate a request and return the application actor:
 *   { userId, role, displayName, cognitoSub }
 * userId is the application id used for ownership (e.g. n1), never the sub.
 */
export async function authenticate(event) {
  const settings = authSettings();
  const claims = getVerifiedClaims(event);
  const { sub, groups } = validateClaims(claims, settings);
  const role = resolveRole(groups);
  const profile = await loadProvisionedProfile(sub);
  if (profile.role !== role) {
    throw new HttpError(403, 'role_mismatch',
      'Your CareBridge role does not match your account setup. Ask an administrator to fix it.');
  }
  return Object.freeze({
    userId: profile.userId,
    role,
    displayName: typeof profile.displayName === 'string' ? profile.displayName : profile.userId,
    cognitoSub: sub,
  });
}

export function requireRole(actor, ...allowed) {
  if (!allowed.includes(actor.role)) {
    throw new HttpError(403, 'forbidden', 'Your role cannot perform this action.');
  }
}
