import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAnalysis, BedrockError } from './bedrock.ts';
import type { BedrockAnalysisPayload } from './types.ts';

const valid: BedrockAnalysisPayload = {
  urgency: 'CRITICAL',
  risks: ['bp dropping'],
  unresolved_tasks: ['recheck in 30m'],
  recommended_follow_up: ['notify charge nurse'],
  handoff_summary: 'Patient needs close monitoring.',
  confidence: 0.8,
  evidence_update_ids: ['U1'],
  requires_human_review: true,
};

test('validateAnalysis accepts a well-formed payload', () => {
  assert.deepEqual(validateAnalysis({ ...valid }), valid);
});

test('validateAnalysis rejects an invalid urgency', () => {
  assert.throws(
    () => validateAnalysis({ ...valid, urgency: 'URGENT' }),
    (e) => e instanceof BedrockError && e.reason === 'schema-validation',
  );
});

test('validateAnalysis rejects non-array risks', () => {
  assert.throws(
    () => validateAnalysis({ ...valid, risks: 'bp dropping' }),
    (e) => e instanceof BedrockError && e.reason === 'schema-validation',
  );
});

test('validateAnalysis rejects confidence out of [0,1]', () => {
  assert.throws(
    () => validateAnalysis({ ...valid, confidence: 1.5 }),
    (e) => e instanceof BedrockError && e.reason === 'schema-validation',
  );
});

test('validateAnalysis enforces requires_human_review === true', () => {
  assert.throws(
    () => validateAnalysis({ ...valid, requires_human_review: false }),
    (e) => e instanceof BedrockError && e.reason === 'schema-validation',
  );
});

test('validateAnalysis rejects an empty handoff_summary', () => {
  assert.throws(
    () => validateAnalysis({ ...valid, handoff_summary: '   ' }),
    (e) => e instanceof BedrockError && e.reason === 'schema-validation',
  );
});

test('validateAnalysis rejects a non-object', () => {
  assert.throws(
    () => validateAnalysis('nope'),
    (e) => e instanceof BedrockError && e.reason === 'schema-validation',
  );
});
