// Pure planning for the server-side identity mapping (Cognito sub -> app user).
//
// Produces DynamoDB DocumentClient TransactWriteItems input; it performs no
// I/O, so the same plan is exercised by tests and by provision-identity.js.
//
// Invariants enforced by the transaction conditions:
//   - one Cognito sub maps to at most one application user
//     (IDENTITY#<sub> may only be rewritten for the same userId)
//   - one application user is bound to at most one Cognito sub
//     (USER#<id>.cognitoSub may only be set when absent or unchanged)
//   - the profile role cannot change implicitly (requires allowRoleChange)
// lib/auth.js checks the same binding in both directions at request time.

import { identityKey, userKey } from '../../src/lib/keys.js';

export const PROVISIONABLE_ROLES = Object.freeze(['nurse', 'charge_nurse']);
const SUB_PATTERN = /^[0-9a-fA-F-]{8,64}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DISPLAY_NAME = 100;

export class ProvisioningError extends Error {}

function assertSub(cognitoSub) {
  if (typeof cognitoSub !== 'string' || !SUB_PATTERN.test(cognitoSub)) {
    throw new ProvisioningError('A valid Cognito sub is required.');
  }
}

function assertUserId(appUserId) {
  if (typeof appUserId !== 'string' || !USER_ID_PATTERN.test(appUserId)) {
    throw new ProvisioningError('App user id must be 1-64 letters, numbers, "_" or "-" (for example n1 or c1).');
  }
}

/**
 * Plan binding a Cognito account to an application user.
 *
 * @param {object} args
 * @param {string} args.tableName
 * @param {string} args.cognitoSub      verified sub read from Cognito (AdminGetUser)
 * @param {string} args.appUserId       existing application id, e.g. n1
 * @param {string} args.role            nurse | charge_nurse
 * @param {string[]} [args.cognitoGroups] the user's Cognito groups; when given
 *                                      they must be exactly [role], matching
 *                                      the runtime role policy in lib/auth.js
 * @param {string} [args.displayName]   set when provided; otherwise kept, or
 *                                      defaulted to the app user id
 * @param {string} args.provisionedBy   administrator label for the record
 * @param {boolean} [args.allowRoleChange]
 * @param {string} [args.now]
 */
export function planIdentityBinding({
  tableName, cognitoSub, appUserId, role, cognitoGroups, displayName,
  provisionedBy, allowRoleChange = false, now = new Date().toISOString(),
}) {
  if (!tableName) throw new ProvisioningError('A table name is required.');
  assertSub(cognitoSub);
  assertUserId(appUserId);
  if (!PROVISIONABLE_ROLES.includes(role)) {
    throw new ProvisioningError(`Role must be one of: ${PROVISIONABLE_ROLES.join(', ')}.`);
  }
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > MAX_DISPLAY_NAME) {
      throw new ProvisioningError(`Display name must be 1-${MAX_DISPLAY_NAME} characters.`);
    }
  }
  if (!provisionedBy) throw new ProvisioningError('provisionedBy is required.');

  if (cognitoGroups !== undefined) {
    const groups = [...new Set(cognitoGroups)];
    if (groups.length !== 1 || groups[0] !== role) {
      throw new ProvisioningError(
        `The Cognito user must belong to exactly one group, "${role}" `
        + `(found: ${groups.length ? groups.join(', ') : 'none'}). Fix the group membership first.`,
      );
    }
  }

  const values = {
    ':entity': 'USER',
    ':uid': appUserId,
    ':role': role,
    ':sub': cognitoSub,
    ':now': now,
    ':by': provisionedBy,
  };
  let displayClause = 'displayName = if_not_exists(displayName, :uid)';
  if (displayName !== undefined) {
    values[':dn'] = displayName.trim();
    displayClause = 'displayName = :dn';
  }

  const bindingCondition = '(attribute_not_exists(cognitoSub) OR cognitoSub = :sub)';
  const roleCondition = '(attribute_not_exists(#role) OR #role = :role)';

  return {
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: {
            ...identityKey(cognitoSub),
            entity: 'IDENTITY',
            cognitoSub,
            userId: appUserId,
            provisionedAt: now,
            provisionedBy,
          },
          // Re-running for the same pair is fine; re-pointing a sub is not.
          ConditionExpression: 'attribute_not_exists(PK) OR userId = :uid',
          ExpressionAttributeValues: { ':uid': appUserId },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: userKey(appUserId),
          UpdateExpression:
            `SET #entity = :entity, userId = :uid, #role = :role, cognitoSub = :sub, ${displayClause}, `
            + 'identityBoundAt = :now, identityBoundBy = :by',
          ConditionExpression: allowRoleChange ? bindingCondition : `${bindingCondition} AND ${roleCondition}`,
          ExpressionAttributeNames: { '#entity': 'entity', '#role': 'role' },
          ExpressionAttributeValues: values,
        },
      },
    ],
  };
}

/**
 * Plan removing a binding. Deleting the mapping blocks API access immediately,
 * even while an already-issued access token is still unexpired.
 */
export function planIdentityRemoval({ tableName, cognitoSub, appUserId }) {
  if (!tableName) throw new ProvisioningError('A table name is required.');
  assertSub(cognitoSub);
  assertUserId(appUserId);
  return {
    TransactItems: [
      {
        Delete: {
          TableName: tableName,
          Key: identityKey(cognitoSub),
          ConditionExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': appUserId },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: userKey(appUserId),
          UpdateExpression: 'REMOVE cognitoSub, identityBoundAt, identityBoundBy',
          ConditionExpression: 'cognitoSub = :sub',
          ExpressionAttributeValues: { ':sub': cognitoSub },
        },
      },
    ],
  };
}
