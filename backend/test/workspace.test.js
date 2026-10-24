// Nurse workspace read scope, idempotent update saves, and corrections.
// Uses mocked authorizer claims (see helpers/setup.js); not a live Cognito test.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_ID, resetData, claimsFor, apiEvent, parse,
} from './helpers/setup.js';

const { handler: workspace } = await import('../src/handlers/workspace.js');
const { handler: updates } = await import('../src/handlers/updates.js');
const { handler: tasks } = await import('../src/handlers/tasks.js');
const keys = await import('../src/lib/keys.js');

const id = INCIDENT_ID;
const read = (claims, incidentId = id) => workspace(apiEvent({
  method: 'GET', resource: '/incidents/{incidentId}/workspace', pathParameters: { incidentId }, claims,
})).then(parse);
const createUpdate = (claims, body) => updates(apiEvent({
  method: 'POST', resource: '/incidents/{incidentId}/updates', pathParameters: { incidentId: id }, claims, body,
})).then(parse);
const correctUpdate = (claims, updateId, body) => updates(apiEvent({
  method: 'PATCH', resource: '/incidents/{incidentId}/updates/{updateId}',
  pathParameters: { incidentId: id, updateId }, claims, body,
})).then(parse);

let fake;
beforeEach(() => { fake = resetData(); });

describe('workspace access', () => {
  test('no verified identity -> 401', async () => {
    assert.equal((await read(undefined)).status, 401);
  });

  test('unmapped user -> 403 not_provisioned', async () => {
    const res = await read(claimsFor.stranger());
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'not_provisioned');
  });

  test('charge nurse -> 403 (the dashboard is their view)', async () => {
    const res = await read(claimsFor.olivia());
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'forbidden');
  });

  test('unknown incident -> 404', async () => {
    assert.equal((await read(claimsFor.sarah(), 'INC-missing')).status, 404);
  });
});

describe('workspace scope', () => {
  test("a nurse sees only their own patients, tasks, and updates", async () => {
    const res = await read(claimsFor.sarah());
    assert.equal(res.status, 200);
    const { patients, tasks: myTasks, updates: myUpdates } = res.body;

    assert.deepEqual(patients.map((p) => p.id).sort(), ['CB-1001', 'CB-1005']);
    assert.ok(patients.every((p) => p.nurse === 'n1' && p.assignedToMe));
    assert.deepEqual(myTasks.map((t) => t.id).sort(), ['TSK-201', 'TSK-207']);
    assert.ok(myTasks.every((t) => t.nurse === 'n1'));
    assert.deepEqual(myUpdates.map((u) => u.id).sort(), ['UPD-101', 'UPD-105']);
    assert.ok(myUpdates.every((u) => u.nurse === 'n1'));
    assert.equal(res.body.nurse.userId, 'n1');
  });

  test('no recommendations, audit events, or storage keys are exposed', async () => {
    const res = await read(claimsFor.sarah());
    assert.equal(res.body.recommendations, undefined);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('"PK"') && !text.includes('GSI1PK'), 'table keys stripped');
    assert.ok(!text.includes('REC-0'), 'no recommendation ids');
    assert.ok(!text.includes('AUDIT'), 'no audit records');
  });

  test("another nurse's records never appear", async () => {
    const res = await read(claimsFor.james());
    const ids = [...res.body.patients, ...res.body.tasks, ...res.body.updates].map((x) => x.id);
    for (const sarahs of ['CB-1001', 'CB-1005', 'TSK-201', 'TSK-207', 'UPD-101', 'UPD-105']) {
      assert.ok(!ids.includes(sarahs), `${sarahs} leaked to n2`);
    }
  });

  test('indicators reflect stored data and task changes', async () => {
    const before = await read(claimsFor.sarah());
    const tsk201 = before.body.tasks.find((t) => t.id === 'TSK-201');
    assert.equal(tsk201.overdue, true, 'fixture TSK-201 is past due');

    const done = await tasks(apiEvent({
      method: 'PATCH', resource: '/incidents/{incidentId}/tasks/{taskId}',
      pathParameters: { incidentId: id, taskId: 'TSK-201' }, claims: claimsFor.sarah(),
      body: { status: 'Completed' },
    })).then(parse);
    assert.equal(done.status, 200);

    const after = await read(claimsFor.sarah());
    const updated = after.body.tasks.find((t) => t.id === 'TSK-201');
    assert.equal(updated.status, 'Completed');
    assert.equal(updated.overdue, false, 'completed work is no longer overdue');
  });

  test('a task reassigned to the nurse brings its patient into view', async () => {
    const reassign = await tasks(apiEvent({
      method: 'PATCH', resource: '/incidents/{incidentId}/tasks/{taskId}',
      pathParameters: { incidentId: id, taskId: 'TSK-202' }, claims: claimsFor.olivia(),
      body: { assignedNurse: 'n1' },
    })).then(parse);
    assert.equal(reassign.status, 200);

    const res = await read(claimsFor.sarah());
    assert.ok(res.body.tasks.some((t) => t.id === 'TSK-202'));
    const patient = res.body.patients.find((p) => p.id === 'CB-1002');
    assert.ok(patient, 'patient for the reassigned task is visible');
    assert.equal(patient.assignedToMe, false);
  });

  test('patients include continuity profile fields', async () => {
    const res = await read(claimsFor.sarah());
    const p = res.body.patients.find((x) => x.id === 'CB-1001');
    assert.deepEqual(p.allergies, ['Penicillin']);
    assert.ok(Array.isArray(p.medications) && p.medications.length > 0);
  });
});

describe('saving nurse updates', () => {
  test('a saved update appears in the workspace with its author and original text', async () => {
    const res = await createUpdate(claimsFor.sarah(), {
      patient: 'CB-1005', category: 'Patient update', text: 'Synthetic check-in note.', urgent: true,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.processing, 'not_processed');

    const ws = await read(claimsFor.sarah());
    const saved = ws.body.updates.find((u) => u.id === res.body.id);
    assert.equal(saved.nurse, 'n1');
    assert.equal(saved.text, 'Synthetic check-in note.');
    assert.equal(saved.urgent, true);
    assert.equal(ws.body.updates[0].id, res.body.id, 'newest first');
  });

  test('retrying the same submission does not create a duplicate', async () => {
    const body = { patient: 'CB-1001', text: 'Synthetic retry note.', clientRequestId: 'req-0001-abcd' };
    const first = await createUpdate(claimsFor.sarah(), body);
    const second = await createUpdate(claimsFor.sarah(), body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);

    const saved = fake.all().filter((i) => i.entity === 'UPDATE' && i.text === 'Synthetic retry note.');
    assert.equal(saved.length, 1);
    const audits = fake.all().filter((i) => i.entity === 'AUDIT' && i.targetId === first.body.id);
    assert.equal(audits.length, 1, 'one creation audit event');
  });

  test("the same request id from a different nurse is a separate update", async () => {
    const body = { patient: 'CB-1001', text: 'Synthetic shared id.', clientRequestId: 'req-0002-abcd' };
    const sarah = await createUpdate(claimsFor.sarah(), body);
    const james = await createUpdate(claimsFor.james(), body);
    assert.equal(sarah.status, 201);
    assert.equal(james.status, 201);
    assert.notEqual(sarah.body.id, james.body.id);
    assert.equal(james.body.nurse, 'n2');
  });

  test('malformed request ids and unknown patients are rejected without saving', async () => {
    const before = fake.all().length;
    const badId = await createUpdate(claimsFor.sarah(), { patient: 'CB-1001', text: 'x', clientRequestId: '../../x' });
    assert.equal(badId.status, 400);
    const badPatient = await createUpdate(claimsFor.sarah(), { patient: 'CB-9999', text: 'x' });
    assert.equal(badPatient.status, 400);
    assert.equal(badPatient.body.error.code, 'invalid_patient');
    assert.equal(fake.all().length, before);
  });
});

describe('correcting an update', () => {
  test('category and urgent can be corrected; the prior version is preserved', async () => {
    const original = fake.get(keys.updateKey(id, 'UPD-101'));
    const res = await correctUpdate(claimsFor.sarah(), 'UPD-101', {
      text: 'Synthetic corrected note.', category: 'Patient update', urgent: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.text, 'Synthetic corrected note.');
    assert.equal(res.body.category, 'Patient update');
    assert.equal(res.body.urgent, false);
    assert.equal(res.body.createdAt, original.createdAt, 'original timestamp kept');
    assert.equal(res.body.nurse, 'n1');
    assert.deepEqual(
      { text: res.body.editHistory[0].text, category: res.body.editHistory[0].category, urgent: res.body.editHistory[0].urgent },
      { text: original.text, category: original.category, urgent: original.urgent },
    );
  });

  test('omitting category and urgent keeps the current values', async () => {
    const original = fake.get(keys.updateKey(id, 'UPD-101'));
    const res = await correctUpdate(claimsFor.sarah(), 'UPD-101', { text: 'Synthetic text only.' });
    assert.equal(res.body.category, original.category);
    assert.equal(res.body.urgent, original.urgent);
  });

  test('invalid category or urgent values are rejected and nothing changes', async () => {
    const original = fake.get(keys.updateKey(id, 'UPD-101'));
    for (const body of [{ text: 'x', category: 'Diagnosis' }, { text: 'x', urgent: 'yes' }]) {
      const res = await correctUpdate(claimsFor.sarah(), 'UPD-101', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(fake.get(keys.updateKey(id, 'UPD-101')), original);
  });
});
