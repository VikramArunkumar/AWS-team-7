// Application staff lookups for charge nurse actions (FR-34, FR-37).
//
// Assignments must name a provisioned nurse. Ids come from request bodies, so
// they are checked against the server-side USER#<id> profile and never trusted
// as-is. Only display fields leave this module; Cognito subs stay server-side.

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './ddb.js';
import { userKey } from './keys.js';
import { HttpError } from './http.js';
import { ROLES } from './auth.js';

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function loadProfile(userId) {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) return null;
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: userKey(userId) }));
  return res.Item ?? null;
}

/** Throw 400 unless userId is a provisioned nurse. */
export async function assertNurse(userId) {
  const profile = await loadProfile(userId);
  if (!profile || profile.role !== ROLES.NURSE) {
    throw new HttpError(400, 'invalid_assignee', 'Choose a nurse on this unit.');
  }
}

/** Display names for the given application user ids (unknown ids are skipped). */
export async function staffDirectory(userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const profiles = await Promise.all(unique.map(loadProfile));
  return profiles
    .filter(Boolean)
    .map((p) => ({ userId: p.userId, displayName: p.displayName ?? p.userId, role: p.role }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const PRIORITIES = ['High', 'Moderate', 'Low'];

/** Validate an optional ISO due time; returns the normalized value or null. */
export function parseDueAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new HttpError(400, 'invalid_due', 'Due time must be a valid date and time.');
  return new Date(ms).toISOString();
}
