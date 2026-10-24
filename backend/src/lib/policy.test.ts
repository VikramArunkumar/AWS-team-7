import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  askPolicy,
  setClient,
  NO_POLICY_ANSWER,
  NO_POLICY_RECOMMENDATION,
} from './policy.ts';

/** Switchable fake Bedrock agent-runtime client. */
class FakeAgent {
  mode: 'grounded' | 'no-citations' | 'throw' = 'grounded';

  async send(command: { constructor: { name: string } }): Promise<unknown> {
    if (command.constructor.name !== 'RetrieveAndGenerateCommand') {
      throw new Error('Unexpected command');
    }
    if (this.mode === 'throw') throw new Error('kb down');
    if (this.mode === 'no-citations') {
      return { output: { text: 'Some ungrounded text the model made up.' }, citations: [] };
    }
    return {
      output: { text: 'During an EHR outage, capture updates on downtime forms.' },
      citations: [
        {
          retrievedReferences: [
            {
              content: { text: 'Continue delivering essential patient care without interruption.' },
              location: { s3Location: { uri: 's3://carebridge-policies/ehr-outage-procedure.md' } },
            },
          ],
        },
      ],
    };
  }
}

let fake: FakeAgent;

beforeEach(() => {
  process.env.KB_ID = 'kb-123';
  process.env.KB_MODEL_ARN = 'arn:aws:bedrock:us-east-1::foundation-model/model';
  delete process.env.POLICY_MOCK;
  fake = new FakeAgent();
  setClient(fake as unknown as Parameters<typeof setClient>[0]);
});

test('grounded answer returns generated text with a citation', async () => {
  const res = await askPolicy('What do I do during an EHR outage?');
  assert.equal(res.hasSupport, true);
  assert.match(res.answer, /EHR outage/);
  assert.equal(res.citations.length, 1);
  assert.equal(res.citations[0]?.s3Uri, 's3://carebridge-policies/ehr-outage-procedure.md');
  assert.match(res.citations[0]?.title ?? '', /ehr outage procedure/);
});

test('no citations => no-policy response, never the ungrounded text', async () => {
  fake.mode = 'no-citations';
  const res = await askPolicy('What is the capital of France?');
  assert.equal(res.hasSupport, false);
  assert.equal(res.answer, NO_POLICY_ANSWER);
  assert.equal(res.recommendation, NO_POLICY_RECOMMENDATION);
  assert.equal(res.citations.length, 0);
  assert.doesNotMatch(res.answer, /made up/);
});

test('KB error => no-policy response (does not fabricate)', async () => {
  fake.mode = 'throw';
  const res = await askPolicy('How do I escalate?');
  assert.equal(res.hasSupport, false);
  assert.equal(res.answer, NO_POLICY_ANSWER);
});

test('KB not configured => no-policy response', async () => {
  delete process.env.KB_ID;
  const res = await askPolicy('How do I document on paper?');
  assert.equal(res.hasSupport, false);
  assert.equal(res.answer, NO_POLICY_ANSWER);
});

test('mock mode answers known topics and refuses unknown ones', async () => {
  process.env.POLICY_MOCK = '1';
  const med = await askPolicy('medication eMAR down, what do I do?');
  assert.equal(med.hasSupport, true);
  assert.equal(med.citations.length, 1);

  const unknown = await askPolicy('what time is lunch?');
  assert.equal(unknown.hasSupport, false);
  assert.equal(unknown.answer, NO_POLICY_ANSWER);
});
