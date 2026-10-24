import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  NurseUpdate,
  Extraction,
  Recommendation,
  Task,
  OutageState,
} from './types.ts';

/**
 * These are type-level smoke tests. They don't exercise runtime behavior (there
 * is none yet) but they confirm the shared type module loads and that the
 * documented invariants are expressible: AI output references an update by id
 * and never replaces it, and a Task can be linked back to a Recommendation.
 */

test('types module is importable and shapes are constructible', () => {
  const outage: OutageState = { status: 'active', startedAt: '2026-10-23T00:00:00Z' };

  const update: NurseUpdate = {
    updateId: 'U1',
    patientId: 'P1',
    authorRole: 'nurse',
    authorName: 'Alex',
    text: 'Patient resting, vitals stable.',
    createdAt: '2026-10-23T00:00:00Z',
  };

  // Extraction references the update by id; it does not contain/replace the text.
  const extraction: Extraction = {
    extractionId: 'E1',
    updateId: update.updateId,
    patientId: update.patientId,
    model: 'mock',
    createdAt: '2026-10-23T00:01:00Z',
    risks: [],
    unresolvedTasks: [],
    followUps: [],
  };

  const rec: Recommendation = {
    recId: 'R1',
    type: 'assignment',
    patientId: update.patientId,
    updateId: update.updateId,
    content: { description: 'Recheck vitals in 1h' },
    priority: 'high',
    priorityRank: 1,
    rationale: 'High-urgency unresolved task',
    status: 'pending',
    createdAt: '2026-10-23T00:02:00Z',
  };

  const task: Task = {
    taskId: 'T1',
    patientId: update.patientId,
    assignee: 'Alex',
    description: rec.content.description,
    priority: 'high',
    status: 'open',
    recId: rec.recId,
    createdAt: '2026-10-23T00:03:00Z',
    updatedAt: '2026-10-23T00:03:00Z',
  };

  assert.equal(outage.status, 'active');
  assert.equal(extraction.updateId, update.updateId);
  assert.notEqual((extraction as unknown as { text?: string }).text, update.text);
  assert.equal(rec.status, 'pending');
  assert.equal(task.recId, rec.recId);
});
