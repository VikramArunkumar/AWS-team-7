// Charge nurse dashboard data and decision actions: staff names, assignment
// validation, modified approvals, and single-run AI processing.
// Uses mocked authorizer claims (see helpers/setup.js); not a live Cognito test.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_ID, resetData, claimsFor, apiEvent, parse,
} from './helpers/setup.js';

const { handler: dashboard } = await import('../src/handlers/dashboard.js');
const { handler: recommendations } = await import('../src/handlers/recommendations.js');
const { handler: tasks } = await import('../src/handlers/tasks.js');
const { handler: updates } = await import('../src/handlers/updates.js');
const keys = await import('../src/lib/keys.js');

const id = INCIDENT_ID;
const charge = claimsFor.olivia;

const readDashboard = () => dashboard(apiEvent({
  method: 'GET', resource: '/incidents/{incidentId}/dashboard', pathParameters: { incidentId: id }, claims: charge(),
})).then(parse);
const approve = (recommendationId, body, claims = charge()) => recommendations(apiEvent({
  method: 'POST', resource: '/incidents/{incidentId}/recommendations/{recommendationId}/approve',
  pathParameters: { incidentId: id, recommendationId }, claims, body,
})).then(parse);
const reject = (recommendationId, body = {}) => recommendations(apiEvent({
  method: 'POST', resource: '/incidents/{incidentId}/recommendations/{recommendationId}/reject',
  pathParameters: { incidentId: id, recommendationId }, claims: charge(), body,
})).then(parse);
const patchTask = (taskId, body, claims = charge()) => tasks(apiEvent({
  method: 'PATCH', resource: '/incidents/{incidentId}/tasks/{taskId}',
  pathParameters: { incidentId: id, taskId }, claims, body,
})).then(parse);
const processUpdate = (updateId) => updates(apiEvent({
  method: 'POST', resource: '/incidents/{incidentId}/updates/{updateId}/process',
  pathParameters: { incidentId: id, updateId }, claims: charge(),
})).then(parse);

let fake;
beforeEach(() => { fake = resetData(); });

const tasksFrom = (recId) => fake.all().filter((i) => i.entity === 'TASK' && i.fromRecommendation === recId);

describe('dashboard staff directory', () => {
  test('lists display names for referenced staff without Cognito identifiers', async () => {
    const res = await readDashboard();
    assert.equal(res.status, 200);
    const ids = res.body.staff.map((s) => s.userId);
    for (const expected of ['n1', 'n2', 'n3', 'n4', 'c1']) assert.ok(ids.includes(expected), expected);
    const sarah = res.body.staff.find((s) => s.userId === 'n1');
    assert.deepEqual(sarah, { userId: 'n1', displayName: 'Sarah Chen', role: 'nurse' });
    assert.ok(!JSON.stringify(res.body.staff).includes('cognitoSub'));
  });

  test('saved nurse work is visible to the charge nurse', async () => {
    await patchTask('TSK-201', { status: 'Completed' }, claimsFor.sarah());
    const res = await readDashboard();
    const task = res.body.tasks.find((t) => t.id === 'TSK-201');
    assert.equal(task.status, 'Completed');
    assert.equal(task.overdue, false);
  });
});

describe('approving a recommendation', () => {
  test('requires a provisioned nurse as the assignee; nothing is applied otherwise', async () => {
    for (const body of [{}, { assignedNurse: 'c1' }, { assignedNurse: 'n99' }, { assignedNurse: '../x' }]) {
      const res = await approve('REC-01', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'invalid_assignee');
    }
    assert.equal(fake.get(keys.recommendationKey(id, 'REC-01')).status, 'proposed');
    assert.equal(tasksFrom('REC-01').length, 0);
  });

  test('rejects invalid priority, empty description, and bad due times', async () => {
    for (const body of [
      { assignedNurse: 'n1', priority: 'Critical' },
      { assignedNurse: 'n1', description: '   ' },
      { assignedNurse: 'n1', dueAt: 'soon' },
    ]) {
      const res = await approve('REC-01', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(fake.get(keys.recommendationKey(id, 'REC-01')).status, 'proposed');
    assert.equal(tasksFrom('REC-01').length, 0);
  });

  test('a modified approval creates one task with the charge nurse edits and source links', async () => {
    const dueAt = '2026-10-24T18:30:00.000Z';
    const res = await approve('REC-01', {
      assignedNurse: 'n2', priority: 'High', description: 'Synthetic edited task', dueAt,
    });
    assert.equal(res.status, 201);
    const task = fake.get(keys.taskKey(id, res.body.task.id));
    assert.equal(task.nurse, 'n2');
    assert.equal(task.priority, 'High');
    assert.equal(task.description, 'Synthetic edited task');
    assert.equal(task.dueAt, dueAt);
    assert.equal(task.status, 'Unconfirmed');
    assert.equal(task.creator, 'c1');
    assert.deepEqual(task.sourceUpdateIds, ['UPD-101']);
    assert.equal(task.GSI1PK, `INCIDENT#${id}#NURSE#n2`);

    const repeat = await approve('REC-01', { assignedNurse: 'n2' });
    assert.equal(repeat.status, 409);
    assert.equal(tasksFrom('REC-01').length, 1, 'no duplicate task on retry');
  });

  test('a nurse cannot approve even with a valid assignee', async () => {
    const res = await approve('REC-01', { assignedNurse: 'n1' }, claimsFor.sarah());
    assert.equal(res.status, 403);
    assert.equal(tasksFrom('REC-01').length, 0);
  });

  test('rejection applies nothing and blocks a later approval', async () => {
    const res = await reject('REC-02', { reason: 'Synthetic: already handled.' });
    assert.equal(res.status, 200);
    const rec = fake.get(keys.recommendationKey(id, 'REC-02'));
    assert.equal(rec.status, 'rejected');
    assert.equal(rec.rejectReason, 'Synthetic: already handled.');
    const later = await approve('REC-02', { assignedNurse: 'n1' });
    assert.equal(later.status, 409);
    assert.equal(tasksFrom('REC-02').length, 0);
  });
});

describe('charge nurse task changes', () => {
  test('reassignment must name a provisioned nurse', async () => {
    const original = fake.get(keys.taskKey(id, 'TSK-201'));
    for (const assignedNurse of ['c1', 'n99']) {
      const res = await patchTask('TSK-201', { assignedNurse });
      assert.equal(res.status, 400, assignedNurse);
    }
    assert.deepEqual(fake.get(keys.taskKey(id, 'TSK-201')), original);
  });

  test('due times are validated and normalized', async () => {
    const bad = await patchTask('TSK-201', { dueAt: 'tomorrow-ish' });
    assert.equal(bad.status, 400);
    const good = await patchTask('TSK-201', { dueAt: '2026-10-24T18:30:00Z', priority: 'Low' });
    assert.equal(good.status, 200);
    assert.equal(good.body.dueAt, '2026-10-24T18:30:00.000Z');
    assert.equal(good.body.priority, 'Low');
    const cleared = await patchTask('TSK-201', { dueAt: null });
    assert.equal(cleared.body.dueAt, null);
  });

  test('reassignment moves the task into the new nurse lookup key', async () => {
    const res = await patchTask('TSK-201', { assignedNurse: 'n3' });
    assert.equal(res.status, 200);
    assert.equal(res.body.nurse, 'n3');
    assert.equal(res.body.GSI1PK, `INCIDENT#${id}#NURSE#n3`);
  });
});

describe('AI processing runs once per update', () => {
  test('a second run is refused and creates no extra recommendations', async () => {
    const first = await processUpdate('UPD-104');
    assert.equal(first.status, 201);
    assert.ok(first.body.recommendations.length > 0);
    assert.ok(first.body.recommendations.every((r) => r.status === 'proposed' && r.aiGenerated));
    const count = fake.all().filter((i) => i.entity === 'REC').length;

    const second = await processUpdate('UPD-104');
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'already_processed');
    assert.equal(fake.all().filter((i) => i.entity === 'REC').length, count);
    assert.equal(fake.get(keys.updateKey(id, 'UPD-104')).processing, 'processed');
  });

  test('an update whose processing failed can be retried; its text is unchanged', async () => {
    const before = fake.get(keys.updateKey(id, 'UPD-102'));
    assert.equal(before.processing, 'failed');
    const res = await processUpdate('UPD-102');
    assert.equal(res.status, 201);
    const after = fake.get(keys.updateKey(id, 'UPD-102'));
    assert.equal(after.text, before.text);
    assert.equal(after.nurse, before.nurse);
    assert.equal(after.processing, 'processed');
  });

  test('processing never changes tasks or assignments', async () => {
    const tasksBefore = fake.all().filter((i) => i.entity === 'TASK');
    await processUpdate('UPD-104');
    assert.deepEqual(fake.all().filter((i) => i.entity === 'TASK'), tasksBefore);
  });
});
