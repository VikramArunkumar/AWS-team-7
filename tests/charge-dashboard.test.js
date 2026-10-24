import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  staffDirectory, filterPatients, filterTasks, dueFromChoice, taskChanges, approvalDefaults,
  sourceUpdatesFor, decisionErrorMessage, aiErrorMessage,
} from '../src/charge/dashboard.js';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const at = (m) => new Date(NOW + m * 60_000).toISOString();
const staff = [
  { userId: 'n1', displayName: 'Sarah Chen', role: 'nurse' },
  { userId: 'n2', displayName: 'James Wilson', role: 'nurse' },
  { userId: 'c1', displayName: 'Olivia Bennett', role: 'charge_nurse' },
];
const dir = staffDirectory(staff);
const nameOf = (id) => dir.personFor(id).name;

describe('staff directory', () => {
  test('resolves names and lists only nurses as assignees', () => {
    assert.equal(dir.personFor('n1').name, 'Sarah Chen');
    assert.equal(dir.personFor('n1').initials, 'SC');
    assert.deepEqual(dir.nurses.map((n) => n.id).sort(), ['n1', 'n2']);
  });
  test('unknown and missing ids still render', () => {
    assert.equal(dir.personFor('n9').name, 'n9');
    assert.equal(dir.personFor(null).name, 'Unassigned');
  });
});

describe('filtering and sorting', () => {
  const patients = [
    { id: 'P1', name: 'Bea', room: '402', priority: 'Low', nurse: 'n1', verifiedAt: at(-5) },
    { id: 'P2', name: 'Al', room: '401', priority: 'High', nurse: 'n2', verifiedAt: null },
  ];
  test('patients by verification need, nurse, and priority', () => {
    const base = { now: NOW, freshness: 60, nameOf };
    assert.deepEqual(filterPatients(patients, { ...base, filter: 'Needs verification' }).map((p) => p.id), ['P2']);
    assert.deepEqual(filterPatients(patients, { ...base, nurse: 'n1' }).map((p) => p.id), ['P1']);
    assert.deepEqual(filterPatients(patients, base).map((p) => p.id), ['P2', 'P1']);
    assert.deepEqual(filterPatients(patients, { ...base, search: 'james' }).map((p) => p.id), ['P2']);
  });
  test('tasks by overdue status and due time; missing due times last', () => {
    const tasks = [
      { id: 'T1', description: 'a', patient: 'P1', nurse: 'n1', status: 'In progress', dueAt: null },
      { id: 'T2', description: 'b', patient: 'P1', nurse: 'n1', status: 'Delayed', dueAt: at(-10) },
      { id: 'T3', description: 'c', patient: 'P2', nurse: 'n2', status: 'Completed', dueAt: at(-20) },
    ];
    const base = { now: NOW, nameOf, patientName: (id) => id };
    assert.deepEqual(filterTasks(tasks, { ...base, status: 'Overdue' }).map((t) => t.id), ['T2']);
    assert.deepEqual(filterTasks(tasks, base).map((t) => t.id), ['T3', 'T2', 'T1']);
  });
});

describe('charge nurse edits', () => {
  test('due choices produce ISO times or null', () => {
    assert.equal(dueFromChoice('', NOW), null);
    assert.equal(dueFromChoice('30', NOW), at(30));
  });
  test('task changes include only fields that changed', () => {
    const task = { nurse: 'n1', priority: 'High', status: 'Unconfirmed', dueAt: at(10) };
    assert.deepEqual(taskChanges(task, { assignedNurse: 'n1', priority: 'High', status: 'Unconfirmed', due: 'keep' }, NOW), {});
    assert.deepEqual(taskChanges(task, { assignedNurse: 'n2', priority: 'Low', status: 'Delayed', due: '' }, NOW),
      { assignedNurse: 'n2', priority: 'Low', status: 'Delayed', dueAt: null });
  });
  test('approval defaults to the patient nurse and priority', () => {
    const d = approvalDefaults({ title: 'Do x' }, { nurse: 'n2', priority: 'High' }, dir.nurses);
    assert.deepEqual(d, { assignedNurse: 'n2', priority: 'High', description: 'Do x', due: '30' });
  });
  test('recommendation sources keep missing updates visible', () => {
    const rows = sourceUpdatesFor({ sourceUpdateIds: ['U1', 'U9'] }, [{ id: 'U1', text: 'x' }]);
    assert.equal(rows[0].update.text, 'x');
    assert.equal(rows[1].update, null);
  });
  test('error messages say whether anything was applied', () => {
    assert.match(decisionErrorMessage({ status: 400, message: 'Choose a nurse.' }), /^Nothing was applied\. Choose a nurse\./);
    assert.match(decisionErrorMessage({ status: 0, code: 'network_error' }), /couldn't confirm/);
    assert.match(aiErrorMessage({ status: 500 }), /original update is unchanged/);
  });
});
