import { test } from 'node:test';
import assert from 'node:assert/strict';

import { keys, gsi1, newId } from './dynamo.ts';

test('key builders produce the documented PK/SK shapes', () => {
  assert.deepEqual(keys.outage(), { PK: 'OUTAGE', SK: 'STATE' });
  assert.deepEqual(keys.patient('P1'), { PK: 'PATIENT#P1', SK: 'META' });
  assert.deepEqual(keys.update('P1', 'U1'), { PK: 'PATIENT#P1', SK: 'UPDATE#U1' });
  assert.deepEqual(keys.extraction('P1', 'E1'), { PK: 'PATIENT#P1', SK: 'EXTRACTION#E1' });
  assert.deepEqual(keys.recommendation('R1'), { PK: 'REC#R1', SK: 'META' });
  assert.deepEqual(keys.task('T1'), { PK: 'TASK#T1', SK: 'META' });
  assert.deepEqual(keys.audit('A1'), { PK: 'AUDIT', SK: 'ENTRY#A1' });
});

test('recommendation GSI key zero-pads rank so order matches priority', () => {
  const r1 = gsi1.recByStatus('pending', 1, 'x');
  const r10 = gsi1.recByStatus('pending', 10, 'y');
  assert.equal(r1.GSI1PK, 'REC_STATUS#pending');
  assert.ok(r1.GSI1SK < r10.GSI1SK, 'rank 1 should sort before rank 10');
});

test('task and roster GSI keys are shaped as documented', () => {
  assert.deepEqual(gsi1.taskByStatus('open', 'T1'), {
    GSI1PK: 'TASK_STATUS#open',
    GSI1SK: 'T1',
  });
  assert.deepEqual(gsi1.patientRoster('Ann'), { GSI1PK: 'PATIENT', GSI1SK: 'Ann' });
});

test('newId returns sortable, unique ULIDs', () => {
  const a = newId();
  const b = newId();
  assert.equal(a.length, 26);
  assert.notEqual(a, b);
});
