import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processingLabel, isTaskOverdue, isPatientUnverified, sortTasks, upsertById, newRequestId,
  listOrNotRecorded, saveErrorMessage,
} from '../src/nurse/workspace.js';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const minutes = (m) => new Date(NOW + m * 60_000).toISOString();

describe('nurse workspace indicators', () => {
  test('overdue only for open tasks past their due time', () => {
    assert.equal(isTaskOverdue({ dueAt: minutes(-5), status: 'In progress' }, NOW), true);
    assert.equal(isTaskOverdue({ dueAt: minutes(-5), status: 'Completed' }, NOW), false);
    assert.equal(isTaskOverdue({ dueAt: minutes(5), status: 'Unconfirmed' }, NOW), false);
    assert.equal(isTaskOverdue({ dueAt: null, status: 'Delayed' }, NOW), false);
  });

  test('patients without a recent verification are unverified', () => {
    assert.equal(isPatientUnverified({ verifiedAt: null }, NOW), true);
    assert.equal(isPatientUnverified({ verifiedAt: minutes(-61) }, NOW, 60), true);
    assert.equal(isPatientUnverified({ verifiedAt: minutes(-10) }, NOW, 60), false);
  });

  test('every processing label says the update is saved', () => {
    for (const state of ['not_processed', 'pending', 'processed', 'failed', undefined]) {
      assert.match(processingLabel(state), /^Saved/);
    }
    assert.match(processingLabel('failed'), /original update is kept/);
  });
});

describe('nurse workspace state helpers', () => {
  test('open tasks come first, ordered by due time', () => {
    const sorted = sortTasks([
      { id: 'a', status: 'Completed', dueAt: minutes(-30) },
      { id: 'b', status: 'In progress', dueAt: minutes(20) },
      { id: 'c', status: 'Delayed', dueAt: minutes(-10) },
      { id: 'd', status: 'Unconfirmed', dueAt: null },
    ]);
    assert.deepEqual(sorted.map((t) => t.id), ['c', 'b', 'd', 'a']);
  });

  test('upsert replaces a saved record or adds a new one to the front', () => {
    const list = [{ id: 'x', v: 1 }, { id: 'y', v: 1 }];
    assert.deepEqual(upsertById(list, { id: 'y', v: 2 }), [{ id: 'x', v: 1 }, { id: 'y', v: 2 }]);
    assert.deepEqual(upsertById(list, { id: 'z', v: 1 })[0], { id: 'z', v: 1 });
    assert.equal(list[1].v, 1, 'input not mutated');
  });

  test('request ids satisfy the backend format and differ per call', () => {
    const a = newRequestId();
    assert.match(a, /^[A-Za-z0-9-]{8,64}$/);
    assert.notEqual(a, newRequestId());
  });

  test('save errors say plainly that nothing was saved', () => {
    assert.match(saveErrorMessage({ code: 'network_error' }), /^Your update was not saved\./);
    assert.match(saveErrorMessage({ code: 'incident_closed' }, { correcting: true }), /^Your correction was not saved\./);
    assert.match(saveErrorMessage({ message: 'Choose a patient.' }), /Choose a patient\./);
  });

  test('missing continuity fields read as not recorded', () => {
    assert.equal(listOrNotRecorded(undefined), 'Not recorded');
    assert.equal(listOrNotRecorded([]), 'Not recorded');
    assert.equal(listOrNotRecorded(['Penicillin', 'Latex']), 'Penicillin, Latex');
  });
});
