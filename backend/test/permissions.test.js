// Role and ownership enforcement across the application routes.
// Uses mocked authorizer claims (see helpers/setup.js); not a live Cognito test.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_ID, SUBS, resetData, claimsFor, apiEvent, parse,
} from './helpers/setup.js';

const { handler: incidents } = await import('../src/handlers/incidents.js');
const { handler: updates } = await import('../src/handlers/updates.js');
const { handler: recommendations } = await import('../src/handlers/recommendations.js');
const { handler: tasks } = await import('../src/handlers/tasks.js');
const { handler: dashboard } = await import('../src/handlers/dashboard.js');
const { handler: me } = await import('../src/handlers/me.js');
const keys = await import('../src/lib/keys.js');

const call = (handler, opts) => handler(apiEvent(opts)).then(parse);
const id = INCIDENT_ID;

// Every application route, with a representative request.
const ROUTES = {
  me: [me, { method: 'GET', resource: '/me' }],
  createIncident: [incidents, { method: 'POST', resource: '/incidents', body: { type: 'EHR outage' } }],
  getIncident: [incidents, { method: 'GET', resource: '/incidents/{incidentId}', pathParameters: { incidentId: id } }],
  deactivate: [incidents, { method: 'POST', resource: '/incidents/{incidentId}/deactivate', pathParameters: { incidentId: id } }],
  dashboard: [dashboard, { method: 'GET', resource: '/incidents/{incidentId}/dashboard', pathParameters: { incidentId: id } }],
  createUpdate: [updates, {
    method: 'POST', resource: '/incidents/{incidentId}/updates', pathParameters: { incidentId: id },
    body: { patient: 'CB-1001', text: 'Synthetic follow-up note.' },
  }],
  editUpdate: [updates, {
    method: 'PATCH', resource: '/incidents/{incidentId}/updates/{updateId}',
    pathParameters: { incidentId: id, updateId: 'UPD-101' }, body: { text: 'Synthetic correction.' },
  }],
  processUpdate: [updates, {
    method: 'POST', resource: '/incidents/{incidentId}/updates/{updateId}/process',
    pathParameters: { incidentId: id, updateId: 'UPD-101' },
  }],
  approve: [recommendations, {
    method: 'POST', resource: '/incidents/{incidentId}/recommendations/{recommendationId}/approve',
    pathParameters: { incidentId: id, recommendationId: 'REC-01' }, body: { assignedNurse: 'n1' },
  }],
  reject: [recommendations, {
    method: 'POST', resource: '/incidents/{incidentId}/recommendations/{recommendationId}/reject',
    pathParameters: { incidentId: id, recommendationId: 'REC-02' }, body: {},
  }],
  createTask: [tasks, {
    method: 'POST', resource: '/incidents/{incidentId}/tasks', pathParameters: { incidentId: id },
    body: { patient: 'CB-1001', description: 'Synthetic task', assignedNurse: 'n1' },
  }],
  patchTask: [tasks, {
    method: 'PATCH', resource: '/incidents/{incidentId}/tasks/{taskId}',
    pathParameters: { incidentId: id, taskId: 'TSK-201' }, body: { status: 'In progress' },
  }],
};

const CHARGE_ONLY = ['createIncident', 'deactivate', 'dashboard', 'processUpdate', 'approve', 'reject', 'createTask'];

function route(name, overrides = {}) {
  const [handler, opts] = ROUTES[name];
  return call(handler, { ...opts, ...overrides });
}

let fake;
beforeEach(() => { fake = resetData(); });

describe('missing identity and header impersonation', () => {
  for (const name of Object.keys(ROUTES)) {
    test(`${name}: no verified identity -> 401`, async () => {
      const res = await route(name);
      assert.equal(res.status, 401);
    });
  }

  test('charge-nurse headers without verified claims cannot approve', async () => {
    const res = await route('approve', { headers: { 'X-User-Id': 'c1', 'X-User-Role': 'charge_nurse' } });
    assert.equal(res.status, 401);
    assert.equal(fake.get(keys.recommendationKey(id, 'REC-01')).status, 'proposed');
  });
});

describe('wrong-role requests are forbidden', () => {
  for (const name of CHARGE_ONLY) {
    test(`nurse -> ${name} is 403`, async () => {
      const res = await route(name, { claims: claimsFor.sarah() });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'forbidden');
    });
  }

  test('a nurse cannot approve a recommendation, even with forged charge headers', async () => {
    const before = fake.all().length;
    const res = await route('approve', {
      claims: claimsFor.sarah(),
      headers: { 'X-User-Id': 'c1', 'X-User-Role': 'charge_nurse' },
    });
    assert.equal(res.status, 403);
    assert.equal(fake.get(keys.recommendationKey(id, 'REC-01')).status, 'proposed');
    assert.equal(fake.all().length, before, 'no task or audit item was written');
  });

  test('a nurse cannot reject a recommendation', async () => {
    const res = await route('reject', { claims: claimsFor.sarah() });
    assert.equal(res.status, 403);
    assert.equal(fake.get(keys.recommendationKey(id, 'REC-02')).status, 'proposed');
  });
});

describe('unknown or unmapped users cannot access application data', () => {
  for (const name of Object.keys(ROUTES)) {
    test(`unmapped user -> ${name} is 403 not_provisioned`, async () => {
      const res = await route(name, { claims: claimsFor.stranger() });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'not_provisioned');
    });
  }
});

describe('ownership rules', () => {
  test("a nurse cannot edit another nurse's update", async () => {
    const original = fake.get(keys.updateKey(id, 'UPD-102'));
    const res = await route('editUpdate', {
      claims: claimsFor.sarah(), pathParameters: { incidentId: id, updateId: 'UPD-102' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(fake.get(keys.updateKey(id, 'UPD-102')), original);
  });

  test('a nurse can correct their own seeded update; the original is preserved', async () => {
    const original = fake.get(keys.updateKey(id, 'UPD-101'));
    const res = await route('editUpdate', { claims: claimsFor.sarah() });
    assert.equal(res.status, 200);
    assert.equal(res.body.nurse, 'n1', 'authorship stays with the application user id');
    assert.equal(res.body.text, 'Synthetic correction.');
    assert.equal(res.body.editHistory.length, 1);
    assert.equal(res.body.editHistory[0].text, original.text);
    assert.equal(res.body.editHistory[0].by, 'n1');
  });

  test("a charge nurse cannot rewrite a nurse's update", async () => {
    const res = await route('editUpdate', { claims: claimsFor.olivia() });
    assert.equal(res.status, 403);
  });

  test("a nurse cannot change another nurse's task", async () => {
    const original = fake.get(keys.taskKey(id, 'TSK-202'));
    for (const body of [{ status: 'Completed' }, { assignedNurse: 'n1' }, { priority: 'Low' }]) {
      const res = await route('patchTask', {
        claims: claimsFor.sarah(), pathParameters: { incidentId: id, taskId: 'TSK-202' }, body,
      });
      assert.equal(res.status, 403, JSON.stringify(body));
    }
    assert.deepEqual(fake.get(keys.taskKey(id, 'TSK-202')), original);
  });

  test('a nurse can report status on their own task but not reassign or reprioritize it', async () => {
    const done = await route('patchTask', { claims: claimsFor.sarah(), body: { status: 'Completed' } });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'Completed');
    assert.equal(done.body.nurse, 'n1');

    for (const body of [{ assignedNurse: 'n3' }, { priority: 'Low' }, { dueAt: '2026-10-23T20:00:00.000Z' }]) {
      const res = await route('patchTask', { claims: claimsFor.sarah(), body });
      assert.equal(res.status, 403, JSON.stringify(body));
    }
    assert.equal(fake.get(keys.taskKey(id, 'TSK-201')).nurse, 'n1');
  });

  test("another nurse cannot change Sarah's task", async () => {
    const res = await route('patchTask', { claims: claimsFor.james(), body: { status: 'Completed' } });
    assert.equal(res.status, 403);
  });
});

describe('a valid charge nurse can reach permitted actions', () => {
  test('dashboard', async () => {
    const res = await route('dashboard', { claims: claimsFor.olivia() });
    assert.equal(res.status, 200);
    assert.equal(res.body.patients.length, 8);
    assert.equal(res.body.recommendations.length, 2);
  });

  test('activate and close an incident', async () => {
    const created = await route('createIncident', { claims: claimsFor.olivia() });
    assert.equal(created.status, 201);
    assert.equal(created.body.activatedBy, 'c1');
    const closed = await route('deactivate', {
      claims: claimsFor.olivia(), pathParameters: { incidentId: created.body.incidentId },
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.status, 'closed');
  });

  test('approve a recommendation once; it creates exactly one task and an audit event', async () => {
    const res = await route('approve', { claims: claimsFor.olivia(), body: { assignedNurse: 'n2', priority: 'High' } });
    assert.equal(res.status, 201);
    const rec = fake.get(keys.recommendationKey(id, 'REC-01'));
    assert.equal(rec.status, 'approved');
    assert.equal(rec.decidedBy, 'c1');
    const task = fake.get(keys.taskKey(id, res.body.task.id));
    assert.equal(task.nurse, 'n2');
    assert.equal(task.creator, 'c1');
    assert.equal(task.fromRecommendation, 'REC-01');

    const audit = fake.all().filter((i) => i.entity === 'AUDIT' && i.action === 'recommendation.approved');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, 'c1');
    assert.equal(audit[0].actorCognitoSub, SUBS.olivia);

    const again = await route('approve', { claims: claimsFor.olivia() });
    assert.equal(again.status, 409);
    assert.equal(fake.all().filter((i) => i.fromRecommendation === 'REC-01').length, 1, 'no duplicate task');
  });

  test('reject a recommendation without applying anything', async () => {
    const res = await route('reject', { claims: claimsFor.olivia() });
    assert.equal(res.status, 200);
    assert.equal(fake.get(keys.recommendationKey(id, 'REC-02')).status, 'rejected');
    assert.equal(fake.all().filter((i) => i.fromRecommendation === 'REC-02').length, 0);
  });

  test('create and reassign tasks, and trigger AI processing', async () => {
    const createdTask = await route('createTask', { claims: claimsFor.olivia() });
    assert.equal(createdTask.status, 201);
    assert.equal(createdTask.body.creator, 'c1');

    const reassigned = await route('patchTask', { claims: claimsFor.olivia(), body: { assignedNurse: 'n3' } });
    assert.equal(reassigned.status, 200);
    assert.equal(reassigned.body.nurse, 'n3');

    const processed = await route('processUpdate', { claims: claimsFor.olivia() });
    assert.equal(processed.status, 201);
    assert.ok(processed.body.recommendations.every((r) => r.status === 'proposed'));
  });

  test('both roles may read incident status', async () => {
    for (const claims of [claimsFor.sarah(), claimsFor.olivia()]) {
      const res = await route('getIncident', { claims });
      assert.equal(res.status, 200);
      assert.equal(res.body.incidentId, id);
    }
  });
});

describe('identity mapping preserves seeded ownership', () => {
  test('a new update is authored by the application user id, not the Cognito sub or the body', async () => {
    const res = await route('createUpdate', {
      claims: claimsFor.sarah(),
      body: { patient: 'CB-1001', text: 'Synthetic follow-up note.', nurse: 'n2' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.nurse, 'n1');

    const audit = fake.all().find((i) => i.entity === 'AUDIT' && i.targetId === res.body.id);
    assert.equal(audit.actorId, 'n1');
    assert.equal(audit.actorRole, 'nurse');
    assert.equal(audit.actorCognitoSub, SUBS.sarah, 'the Cognito identity is retained in audit context');
  });

  test('seeded tasks and updates keep their original owners after mapping', () => {
    assert.equal(fake.get(keys.updateKey(id, 'UPD-101')).nurse, 'n1');
    assert.equal(fake.get(keys.updateKey(id, 'UPD-102')).nurse, 'n2');
    assert.equal(fake.get(keys.taskKey(id, 'TSK-201')).nurse, 'n1');
    assert.equal(fake.get(keys.taskKey(id, 'TSK-202')).nurse, 'n2');
  });

  test("each mapped nurse can act on their own seeded task", async () => {
    const sarah = await route('patchTask', {
      claims: claimsFor.sarah(), pathParameters: { incidentId: id, taskId: 'TSK-207' }, body: { status: 'Delayed' },
    });
    const james = await route('patchTask', {
      claims: claimsFor.james(), pathParameters: { incidentId: id, taskId: 'TSK-202' }, body: { status: 'In progress' },
    });
    assert.equal(sarah.status, 200);
    assert.equal(james.status, 200);
  });
});
