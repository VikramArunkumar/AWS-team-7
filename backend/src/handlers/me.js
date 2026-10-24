// GET /me — confirm backend authentication and report the effective identity.
//
// Returns only the application user's safe identity and effective role. The
// Cognito sub, email, token claims, and group list are intentionally omitted.
// The frontend uses this response (not the token contents) to decide which
// screens to show; every protected action is still enforced server-side.

import { authenticate } from '../lib/auth.js';
import { ok, withErrorHandling, HttpError } from '../lib/http.js';

export const handler = withErrorHandling(async (event) => {
  if (event.httpMethod !== 'GET') {
    throw new HttpError(405, 'method_not_allowed', 'Unsupported method.');
  }
  const actor = await authenticate(event);
  return ok({
    userId: actor.userId,
    displayName: actor.displayName,
    role: actor.role,
  });
});
