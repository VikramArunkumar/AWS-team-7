/**
 * HTTP helper for CareBridge Lambda handlers (task 2.2).
 *
 * Centralizes: JSON body parsing, reading the demo identity headers
 * (X-Demo-Role / X-Demo-User), role enforcement, and the standard response /
 * error envelope with consistent status codes. Handlers stay thin and
 * consistent, and authorization is enforced in one place.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import type { Actor, ApiError, Role } from './types.ts';

export type HttpResult = APIGatewayProxyStructuredResultV2;

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-headers': 'content-type,x-demo-role,x-demo-user',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
};

const VALID_ROLES: readonly Role[] = ['nurse', 'charge-nurse'];

/** Thrown by helpers to short-circuit a handler with a specific status. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Read a header case-insensitively (API Gateway lowercases, but be safe). */
function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const headers = event.headers ?? {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Extract the demo identity. Throws 401 if the role header is missing/invalid,
 * since no action is allowed without a selected role (Req 1.1).
 */
export function getActor(event: APIGatewayProxyEventV2): Actor {
  const role = header(event, 'x-demo-role');
  const name = header(event, 'x-demo-user');

  if (!role || !VALID_ROLES.includes(role as Role)) {
    throw new HttpError(401, 'Missing or invalid X-Demo-Role header.', {
      allowedRoles: VALID_ROLES,
    });
  }
  if (!name || name.trim() === '') {
    throw new HttpError(401, 'Missing X-Demo-User header.');
  }
  return { role: role as Role, name: name.trim() };
}

/** Enforce that the actor holds one of the required roles, else 403. */
export function requireRole(actor: Actor, ...allowed: Role[]): void {
  if (!allowed.includes(actor.role)) {
    throw new HttpError(403, 'Your role is not permitted to perform this action.', {
      role: actor.role,
      requiredRoles: allowed,
    });
  }
}

/** Parse and return the JSON body, or throw 400 on malformed/empty input. */
export function parseBody<T>(event: APIGatewayProxyEventV2): T {
  const raw = event.body;
  if (!raw) {
    throw new HttpError(400, 'Request body is required.');
  }
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

/** Require a non-empty string field, trimmed. Throws 400 otherwise. */
export function requireString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `Field "${field}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** Build a success response. */
export function ok(body: unknown, statusCode = 200): HttpResult {
  return {
    statusCode,
    headers: BASE_HEADERS,
    body: JSON.stringify(body),
  };
}

/** Build an error response from the standard envelope. */
export function errorResponse(statusCode: number, error: string, details?: Record<string, unknown>): HttpResult {
  const payload: ApiError = details ? { error, details } : { error };
  return {
    statusCode,
    headers: BASE_HEADERS,
    body: JSON.stringify(payload),
  };
}

/**
 * Wrap a handler so thrown HttpErrors become proper responses and any other
 * error becomes a safe 500. Keeps every handler's error shape consistent.
 */
export function withErrorHandling(
  fn: (event: APIGatewayProxyEventV2) => Promise<HttpResult>,
): (event: APIGatewayProxyEventV2) => Promise<HttpResult> {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResponse(err.statusCode, err.message, err.details);
      }
      // Never leak internals; log for diagnostics.
      console.error('Unhandled error:', err);
      return errorResponse(500, 'Internal server error.');
    }
  };
}
