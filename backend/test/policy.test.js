// Policy assistant with MOCKED Knowledge Base and Bedrock clients: citations
// come only from retrieved documents, missing evidence is explicit, and access
// requires a provisioned role. Not a live Knowledge Base test.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.BEDROCK_MODE = 'live';
process.env.BEDROCK_MODEL_ID = 'test-model';
process.env.GUARDRAIL_ID = 'test-guardrail';
process.env.KNOWLEDGE_BASE_ID = 'test-kb';

const { resetData, claimsFor, apiEvent, parse } = await import('./helpers/setup.js');
const { handler } = await import('../src/handlers/policy.js');
const { setBedrockClient } = await import('../src/lib/bedrock.js');
const { setKnowledgeBaseClient } = await import('../src/lib/policy-kb.js');

const ask = (question, claims = claimsFor.sarah()) => handler(apiEvent({
  method: 'POST', resource: '/policy/ask', claims, body: { question },
})).then(parse);

const MED_PASSAGE = {
  content: { text: 'Verify each medication against the printed list and a second licensed nurse.' },
  location: { s3Location: { uri: 's3://synthetic-bucket/policies/POL-MED-04.md' } },
  metadata: {
    reference: 'Westbrook Downtime Manual, POL-MED-04',
    title: 'Medication Administration During Downtime',
    section: 'Section 4',
  },
  score: 0.8,
};

function fake(reply) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push(cmd.input);
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(cmd.input) : reply;
    },
  };
}
const modelSays = (obj) => fake({
  stopReason: 'end_turn',
  output: { message: { content: [{ text: JSON.stringify(obj) }] } },
});

beforeEach(() => { resetData(); });

describe('policy assistant', () => {
  test('answers with citations built from the retrieved document', async () => {
    setKnowledgeBaseClient(fake({ retrievalResults: [MED_PASSAGE] }));
    setBedrockClient(modelSays({ found: true, answer: 'Use the printed list and a second nurse.', sources: [1] }));

    const res = await ask('How do I verify meds without the eMAR?');

    assert.equal(res.status, 200);
    assert.equal(res.body.found, true);
    assert.equal(res.body.aiGenerated, true);
    assert.equal(res.body.verifyBeforeActing, true);
    assert.deepEqual(res.body.citations.map((c) => c.reference), ['Westbrook Downtime Manual, POL-MED-04']);
    // The internal S3 location is not exposed.
    assert.doesNotMatch(JSON.stringify(res.body), /s3:\/\//);
  });

  test('nothing retrieved -> found:false, no answer, no citations, model not called', async () => {
    setKnowledgeBaseClient(fake({ retrievalResults: [] }));
    const bedrock = modelSays({ found: true, answer: 'made up', sources: [1] });
    setBedrockClient(bedrock);

    const res = await ask('What is for lunch?');

    assert.equal(res.status, 200);
    assert.deepEqual([res.body.found, res.body.answer, res.body.citations], [false, null, []]);
    assert.equal(bedrock.calls.length, 0);
  });

  test('model says the passages do not answer -> found:false with no citations', async () => {
    setKnowledgeBaseClient(fake({ retrievalResults: [MED_PASSAGE] }));
    setBedrockClient(modelSays({ found: false, answer: null, sources: [] }));
    const res = await ask('What is the parking policy?');
    assert.deepEqual([res.body.found, res.body.citations], [false, []]);
  });

  test('a citation to a passage that was not retrieved is rejected, not shown', async () => {
    setKnowledgeBaseClient(fake({ retrievalResults: [MED_PASSAGE] }));
    setBedrockClient(modelSays({ found: true, answer: 'See policy 7.', sources: [7] }));
    const res = await ask('How do I verify meds?');
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'ai_unavailable');
  });

  test('guardrail intervention -> 422 ai_refused', async () => {
    setKnowledgeBaseClient(fake({ retrievalResults: [MED_PASSAGE] }));
    setBedrockClient(fake({ stopReason: 'guardrail_intervened', output: { message: { content: [{ text: 'x' }] } } }));
    const res = await ask('Which drug dose should I give?');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'ai_refused');
  });

  test('Knowledge Base failure -> 502 ai_unavailable', async () => {
    setKnowledgeBaseClient(fake(Object.assign(new Error('x'), { name: 'ThrottlingException' })));
    const res = await ask('How do I do handoff?');
    assert.equal(res.status, 502);
  });

  test('charge nurses may ask too', async () => {
    setKnowledgeBaseClient(fake({ retrievalResults: [] }));
    const res = await ask('handoff?', claimsFor.olivia());
    assert.equal(res.status, 200);
  });

  test('unprovisioned or unauthenticated callers are refused before retrieval', async () => {
    const kb = fake({ retrievalResults: [MED_PASSAGE] });
    setKnowledgeBaseClient(kb);
    assert.equal((await ask('handoff?', claimsFor.stranger())).status, 403);
    const noAuth = parse(await handler(apiEvent({ method: 'POST', resource: '/policy/ask', body: { question: 'x' } })));
    assert.equal(noAuth.status, 401);
    assert.equal(kb.calls.length, 0);
  });

  test('empty or oversized questions are rejected', async () => {
    assert.equal((await ask('  ')).status, 400);
    assert.equal((await ask('x'.repeat(501))).status, 400);
  });
});
