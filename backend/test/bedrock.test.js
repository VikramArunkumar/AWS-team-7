// Live-mode Bedrock path with a MOCKED Bedrock client: output validation,
// guardrail handling, and failure isolation (the saved update is never lost or
// changed). This does not prove the real model, Guardrail, or IAM work; see
// README "Bedrock" for the live verification steps.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.BEDROCK_MODE = 'live';
process.env.BEDROCK_MODEL_ID = 'test-model';
process.env.GUARDRAIL_ID = 'test-guardrail';

const { INCIDENT_ID, resetData, claimsFor, apiEvent, parse } = await import('./helpers/setup.js');
const { handler: updates } = await import('../src/handlers/updates.js');
const { setBedrockClient, validateModelOutput, BedrockError } = await import('../src/lib/bedrock.js');
const keys = await import('../src/lib/keys.js');
const { ENTITY } = keys;

const id = INCIDENT_ID;
const processUpdate = (updateId) => updates(apiEvent({
  method: 'POST', resource: '/incidents/{incidentId}/updates/{updateId}/process',
  pathParameters: { incidentId: id, updateId }, claims: claimsFor.olivia(),
})).then(parse);

/** Fake Bedrock client that returns `reply` (or throws it) and records requests. */
function fakeBedrock(reply) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push(cmd.input);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}
const modelText = (obj) => ({
  stopReason: 'end_turn',
  output: { message: { role: 'assistant', content: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } },
});

let fake;
beforeEach(() => { fake = resetData(); });

const UPDATE_ID = 'UPD-104';

describe('live Bedrock review of a nurse update', () => {
  test('valid model output becomes proposed, AI-labeled recommendations citing the update', async () => {
    const bedrock = fakeBedrock(modelText({
      recommendations: [{
        title: 'Confirm overdue vitals', reason: 'The update reports vitals were not recorded.',
        priority: 'High', sourceUpdateIds: [UPDATE_ID],
      }],
    }));
    setBedrockClient(bedrock);
    const before = fake.get(keys.updateKey(id, UPDATE_ID));

    const res = await processUpdate(UPDATE_ID);

    assert.equal(res.status, 201);
    assert.equal(res.body.verifyBeforeActing, true);
    const [rec] = res.body.recommendations;
    assert.equal(rec.status, 'proposed');
    assert.equal(rec.aiGenerated, true);
    assert.equal(rec.priority, 'High');
    assert.deepEqual(rec.sourceUpdateIds, [UPDATE_ID]);
    // Guardrail is always attached to the request (NFR-12).
    assert.equal(bedrock.calls[0].guardrailConfig.guardrailIdentifier, 'test-guardrail');
    // Source update content is unchanged (NFR-15).
    const after = fake.get(keys.updateKey(id, UPDATE_ID));
    assert.equal(after.text, before.text);
    assert.equal(after.processing, 'processed');
  });

  for (const [name, reply] of [
    ['malformed JSON', modelText('not json at all')],
    ['a citation to an id that was not supplied', modelText({
      recommendations: [{ title: 'x', reason: 'y', priority: 'Low', sourceUpdateIds: ['UPD-FAKE'] }],
    })],
    ['an invalid priority', modelText({
      recommendations: [{ title: 'x', reason: 'y', priority: 'critical!!', sourceUpdateIds: [UPDATE_ID] }],
    })],
    ['a guardrail intervention', { stopReason: 'guardrail_intervened', output: { message: { content: [{ text: 'blocked' }] } } }],
    ['a service error', Object.assign(new Error('throttled'), { name: 'ThrottlingException' })],
  ]) {
    test(`${name} -> 502 ai_unavailable, no recommendations, update intact and retryable`, async () => {
      setBedrockClient(fakeBedrock(reply));
      const before = fake.get(keys.updateKey(id, UPDATE_ID));
      const recsBefore = fake.all().filter((i) => i.entity === ENTITY.REC).length;

      const res = await processUpdate(UPDATE_ID);

      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'ai_unavailable');
      const after = fake.get(keys.updateKey(id, UPDATE_ID));
      assert.equal(after.text, before.text);
      assert.equal(after.processing, 'failed');
      assert.equal(fake.all().filter((i) => i.entity === ENTITY.REC).length, recsBefore);
      // Model text never leaks into the error response.
      assert.doesNotMatch(JSON.stringify(res.body), /blocked|not json/);
    });
  }

  test('the prompt includes only this patient\'s updates as context', async () => {
    const bedrock = fakeBedrock(modelText({ recommendations: [] }));
    setBedrockClient(bedrock);
    await processUpdate(UPDATE_ID);
    const update = fake.get(keys.updateKey(id, UPDATE_ID));
    const prompt = bedrock.calls[0].messages[0].content[0].text;
    const otherPatientUpdates = fake.all()
      .filter((i) => i.entity === ENTITY.UPDATE && i.patient !== update.patient);
    for (const u of otherPatientUpdates) assert.ok(!prompt.includes(`"id":"${u.id}"`), u.id);
  });
});

describe('validateModelOutput', () => {
  const allowed = new Set(['U1', 'U2']);

  test('strips unknown fields and forces aiGenerated', () => {
    const out = validateModelOutput(JSON.stringify({
      recommendations: [{
        title: ' t ', reason: 'r', priority: 'Moderate', sourceUpdateIds: ['U1', 'U1'],
        status: 'approved', assignedNurse: 'n2', aiGenerated: false,
      }],
    }), allowed);
    assert.deepEqual(out.recommendations, [{
      title: 't', reason: 'r', priority: 'Moderate', sourceUpdateIds: ['U1'], aiGenerated: true,
    }]);
  });

  test('tolerates surrounding prose or code fences', () => {
    const out = validateModelOutput('```json\n{"recommendations":[]}\n```', allowed);
    assert.deepEqual(out.recommendations, []);
  });

  test('rejects a recommendation with no sources', () => {
    assert.throws(() => validateModelOutput(JSON.stringify({
      recommendations: [{ title: 't', reason: 'r', priority: 'Low', sourceUpdateIds: [] }],
    }), allowed), BedrockError);
  });
});
