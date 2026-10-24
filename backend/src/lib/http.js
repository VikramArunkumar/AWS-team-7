// Small HTTP helpers for API Gateway (REST, Lambda proxy) responses and auth.
//
// NFR-11 / security: keep patient data and raw request bodies out of error
// bodies. Responses carry a short machine code plus a safe message only.

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-User-Id,X-User-Role',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
};

export function ok(body, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function created(body) {
  return ok(body, 201);
}

export function error(statusCode, code, message) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: { code, message } }),
  };
}

export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

export const ROLES = { NURSE: 'nurse', CHARGE_NURSE: 'charge_nurse' };

// Identity for the MVP is carried on explicit headers set by the authenticated
// frontend. This is the single place to swap in a Cognito authorizer later
// (read the claims off event.requestContext.authorizer instead) without
// touching the handlers. Role checks below are the real enforcement point
// (NFR-8): hiding a control in the UI is not authorization.
export function getActor(event) {
  const headers = event.headers || {};
  const userId = headers['X-User-Id'] || headers['x-user-id'];
  const role = headers['X-User-Role'] || headers['x-user-role'];
  if (!userId || !role) {
    throw new HttpError(401, 'unauthenticated', 'Missing user identity.');
  }
  if (!Object.values(ROLES).includes(role)) {
    throw new HttpError(401, 'unauthenticated', 'Unknown role.');
  }
  return { userId, role };
}

export function requireRole(actor, role) {
  if (actor.role !== role) {
    throw new HttpError(403, 'forbidden', 'Your role cannot perform this action.');
  }
}

// Wraps a handler so thrown HttpErrors become clean responses and anything
// unexpected becomes a generic 500 without leaking internals.
export function withErrorHandling(fn) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) {
        return error(err.statusCode, err.code, err.message);
      }
      // Log a non-sensitive marker only; never echo the request body.
      console.error('unhandled_error', err?.name, err?.message);
      return error(500, 'internal_error', 'Something went wrong.');
    }
  };
}
