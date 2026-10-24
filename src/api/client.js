// Minimal CareBridge API client.
//
// Sends the Cognito ACCESS token as "Authorization: Bearer <token>". It never
// sends identity or role headers (the backend ignores them anyway), never
// puts tokens in URLs, and never includes tokens in error messages or logs.
// Pure module so it can be unit-tested in Node.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, 'session_expired', 'Your session has ended. Sign in again to continue.');
    this.name = 'SessionExpiredError';
  }
}

const DEFAULT_MESSAGES = {
  401: 'Your session has ended. Sign in again to continue.',
  403: 'Your account does not have access to this.',
  404: 'That item could not be found.',
};

function safeError(status, data) {
  // Only the backend's own { error: { code, message } } shape is surfaced.
  const code = typeof data?.error?.code === 'string' ? data.error.code
    : status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'request_failed';
  const message = typeof data?.error?.message === 'string' ? data.error.message
    : DEFAULT_MESSAGES[status] ?? 'CareBridge could not complete the request. Try again.';
  return new ApiError(status, code, message);
}

/**
 * @param {object} options
 * @param {string} options.baseUrl           e.g. https://abc.execute-api.us-east-1.amazonaws.com/dev
 * @param {() => string|null} options.getAccessToken  returns a current, unexpired access token or null
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createApiClient({ baseUrl, getAccessToken, fetchImpl = globalThis.fetch }) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function request(path, { method = 'GET', body } = {}) {
    if (!path.startsWith('/')) throw new Error('API paths must start with "/".');
    const token = getAccessToken();
    if (!token) throw new SessionExpiredError();

    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Bearer auth only; no cookies are sent to the API.
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
      });
    } catch {
      throw new ApiError(0, 'network_error', 'CareBridge could not be reached. Check your connection and try again.');
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw safeError(res.status, data);
    return data;
  }

  return {
    request,
    /** Verify backend authentication and get the effective identity. */
    getMe: () => request('/me'),
  };
}
