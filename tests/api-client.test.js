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

describe('nurse workspace calls', () => {
  const api = (calls, body = {}) => createApiClient({
    baseUrl: BASE, getAccessToken: () => TOKEN, fetchImpl: async (url, init) => { calls.push({ url, init }); return jsonResponse(200, body); },
  });

  test('reads the workspace for the configured incident', async () => {
    const calls = [];
    await api(calls).getWorkspace('INC-0042');
    assert.equal(calls[0].url, `${BASE}/incidents/INC-0042/workspace`);
    assert.equal(calls[0].init.method, 'GET');
  });

  test('saves an update with its request id and never an author field', async () => {
    const calls = [];
    await api(calls).createUpdate('INC-0042', {
      patient: 'CB-1001', category: 'Patient update', text: 'Synthetic note.', urgent: true, clientRequestId: 'req-1234-abcd',
    });
    assert.equal(calls[0].url, `${BASE}/incidents/INC-0042/updates`);
    assert.equal(calls[0].init.method, 'POST');
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent, {
      patient: 'CB-1001', category: 'Patient update', text: 'Synthetic note.', urgent: true, clientRequestId: 'req-1234-abcd',
    });
    assert.equal(sent.nurse, undefined);
  });

  test('corrects an update and reports task status with PATCH', async () => {
    const calls = [];
    const client = api(calls);
    await client.correctUpdate('INC-0042', 'UPD-101', { text: 'Fixed.', category: 'Handoff', urgent: false });
    await client.setTaskStatus('INC-0042', 'TSK-201', 'Completed');
    assert.equal(calls[0].url, `${BASE}/incidents/INC-0042/updates/UPD-101`);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Fixed.', category: 'Handoff', urgent: false });
    assert.equal(calls[1].url, `${BASE}/incidents/INC-0042/tasks/TSK-201`);
    assert.deepEqual(JSON.parse(calls[1].init.body), { status: 'Completed' });
  });

  test('path segments are encoded so ids cannot change the route', async () => {
    const calls = [];
    await api(calls).setTaskStatus('INC-0042', '../me?x=1', 'Completed');
    assert.equal(calls[0].url, `${BASE}/incidents/INC-0042/tasks/..%2Fme%3Fx%3D1`);
  });
});

describe('charge nurse calls', () => {
  const client = (calls) => createApiClient({
    baseUrl: BASE, getAccessToken: () => TOKEN, fetchImpl: async (url, init) => { calls.push({ url, init }); return jsonResponse(200, {}); },
  });

  test('policy questions POST the question to /policy/ask', async () => {
    const calls = [];
    await client(calls).askPolicy('How do I hand off?');
    assert.equal(`${calls[0].init.method} ${calls[0].url.slice(BASE.length)}`, 'POST /policy/ask');
    assert.deepEqual(JSON.parse(calls[0].init.body), { question: 'How do I hand off?' });
  });

  test('dashboard, decisions, AI review, and task edits use the documented routes', async () => {
    const calls = [];
    const api = client(calls);
    await api.getDashboard('INC-0042');
    await api.approveRecommendation('INC-0042', 'REC-01', { assignedNurse: 'n2', priority: 'High', description: 'Do x', dueAt: null });
    await api.rejectRecommendation('INC-0042', 'REC-02', { reason: '' });
    await api.processUpdate('INC-0042', 'UPD-104');
    await api.updateTask('INC-0042', 'TSK-201', { assignedNurse: 'n3' });
    assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.slice(BASE.length)}`), [
      'GET /incidents/INC-0042/dashboard',
      'POST /incidents/INC-0042/recommendations/REC-01/approve',
      'POST /incidents/INC-0042/recommendations/REC-02/reject',
      'POST /incidents/INC-0042/updates/UPD-104/process',
      'PATCH /incidents/INC-0042/tasks/TSK-201',
    ]);
    assert.deepEqual(JSON.parse(calls[1].init.body), { assignedNurse: 'n2', priority: 'High', description: 'Do x', dueAt: null });
    assert.deepEqual(JSON.parse(calls[2].init.body), {}, 'empty reason is omitted');
    assert.equal(calls[3].init.body, undefined);
    assert.deepEqual(JSON.parse(calls[4].init.body), { assignedNurse: 'n3' });
  });
});
