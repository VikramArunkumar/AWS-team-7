// Small HTTP helpers for API Gateway (REST, Lambda proxy) responses.
//
// Identity is NOT read here. Authentication and role checks live in
// lib/auth.js and use only the claims API Gateway's Cognito authorizer has
// already verified. Caller-supplied headers such as X-User-Id or X-User-Role
// are ignored everywhere.
//
// NFR-11 / security: keep patient data, tokens, and raw request bodies out of
// error bodies. Responses carry a short machine code plus a safe message only.

const ALLOWED_HEADERS = 'Content-Type,Authorization';
const ALLOWED_METHODS = 'GET,POST,PATCH,OPTIONS';

// CORS headers must match the API Gateway configuration in template.yaml.
// ALLOWED_ORIGIN is the single configured frontend origin. If it is missing
// the Access-Control-Allow-Origin header is omitted, so browsers fail closed.
function responseHeaders() {
  const origin = process.env.ALLOWED_ORIGIN;
  return {
    'Content-Type': 'application/json',
    // Protected responses can contain synthetic patient data; never cache them.
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
  };
}

export function ok(body, statusCode = 200) {
  return {
    statusCode,
    headers: responseHeaders(),
    body: JSON.stringify(body),
  };
}

export function created(body) {
  return ok(body, 201);
}

export function error(statusCode, code, message) {
  return {
    statusCode,
    headers: responseHeaders(),
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

// Wraps a handler so thrown HttpErrors become clean responses and anything
// unexpected becomes a generic 500 without leaking internals.
export function withErrorHandling(fn) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') {
      // API Gateway answers preflight itself; this only covers direct invokes.
      return { statusCode: 204, headers: responseHeaders(), body: '' };
    }
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) {
        return error(err.statusCode, err.code, err.message);
      }
      // Log a non-sensitive marker only; never echo the request, claims, or tokens.
      console.error('unhandled_error', err?.name);
      return error(500, 'internal_error', 'Something went wrong.');
    }
  };
}
