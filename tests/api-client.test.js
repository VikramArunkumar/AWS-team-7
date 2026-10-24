import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError, SessionExpiredError } from '../src/api/client.js';

const TOKEN = 'eyJ.synthetic-access-token.sig';
const BASE = 'https://abc123.execute-api.us-east-1.amazonaws.com/dev';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function recorder(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetchImpl };
}

describe('createApiClient', () => {
  test('sends the access token as a Bearer header and no identity headers', async () => {
    const { calls, fetchImpl } = recorder(jsonResponse(200, { userId: 'n1', displayName: 'Sarah Chen', role: 'nurse' }));
    const api = createApiClient({ baseUrl: `${BASE}/`, getAccessToken: () => TOKEN, fetchImpl });
    const me = await api.getMe();

    assert.deepEqual(me, { userId: 'n1', displayName: 'Sarah Chen', role: 'nurse' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/me`, 'stage path is kept and the token is not in the URL');
    const { headers, credentials } = calls[0].init;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(credentials, 'omit');
    for (const name of Object.keys(headers)) {
      assert.ok(!/^x-user/i.test(name), `unexpected identity header ${name}`);
    }
  });

  test('does not call the API without a current token', async () => {
    const { calls, fetchImpl } = recorder(jsonResponse(200, {}));
    const api = createApiClient({ baseUrl: BASE, getAccessToken: () => null, fetchImpl });
    await assert.rejects(api.getMe(), SessionExpiredError);
    assert.equal(calls.length, 0);
  });

  test('surfaces the backend error code and message without the token', async () => {
    const { fetchImpl } = recorder(jsonResponse(403, { error: { code: 'not_provisioned', message: 'Not set up.' } }));
    const api = createApiClient({ baseUrl: BASE, getAccessToken: () => TOKEN, fetchImpl });
    await assert.rejects(api.getMe(), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'not_provisioned');
      assert.ok(!err.message.includes(TOKEN));
      return true;
    });
  });

  test("maps API Gateway's own 401 body to an unauthenticated error", async () => {
    const { fetchImpl } = recorder(jsonResponse(401, { message: 'Unauthorized' }));
    const api = createApiClient({ baseUrl: BASE, getAccessToken: () => TOKEN, fetchImpl });
    await assert.rejects(api.getMe(), { status: 401, code: 'unauthenticated' });
  });

  test('network failures produce a generic, token-free error', async () => {
    const { fetchImpl } = recorder(new TypeError(`Failed to fetch ${TOKEN}`));
    const api = createApiClient({ baseUrl: BASE, getAccessToken: () => TOKEN, fetchImpl });
    await assert.rejects(api.getMe(), (err) => err.code === 'network_error' && !err.message.includes(TOKEN));
  });
});
