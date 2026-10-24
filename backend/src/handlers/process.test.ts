import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { setClient as setDynamo, keys } from '../lib/dynamo.ts';
import { setClient as setBedrock } from '../lib/bedrock.ts';
import { handler } from './process.ts';
import type { NurseUpdate, ProcessUpdateResult } from '../lib/types.ts';

const PATIENT_ID = 'P1';
const UPDATE_ID = 'U1';

const SEED_UPDATE: NurseUpdate = {
  updateId: UPDATE_ID,
  patientId: PATIENT_ID,
  authorRole: 'nurse',
  authorName: 'Alex',
  text: 'Original nurse note — must never be overwritten.',
  createdAt: '2026-10-23T00:00:00Z',
};

class FakeDynamo {
  store = new Map<string, Record<string, unknown>>();
  puts: Record<string, unknown>[] = [];

  seed(key: { PK: string; SK: string }, item: Record<string, unknown>): void {
    this.store.set(`${key.PK}|${key.SK}`, { ...key, ...item });
  }

  async send(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const name = command.constructor.name;
    if (name === 'PutCommand') {
      const item = command.input.Item as Record<string, unknown>;
      this.puts.push(item);
      this.store.set(`${String(item.PK)}|${String(item.SK)}`, item);
      return {};
    }
    if (name === 'GetCommand') {
      const k = command.input.Key as Record<string, unknown>;
      return { Item: this.store.get(`${String(k.PK)}|${String(k.SK)}`) };
    }
    if (name === 'QueryCommand') {
      // Return seeded items matching PK (and optional SK prefix).
      const vals = (command.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      const items = [...this.store.values()].filter(
        (i) =>
          i.PK === vals[':pk'] &&
          (!vals[':sk'] || String(i.SK).startsWith(String(vals[':sk']))),
      );
      return { Items: items };
    }
    throw new Error(`Unexpected command: ${name}`);
  }
}

/** Fake Bedrock runtime client with a switchable behavior. */
class FakeBedrock {
  mode: 'valid' | 'bad-json' | 'throw' = 'valid';

  async send(command: { constructor: { name: string } }): Promise<unknown> {
    if (command.constructor.name !== 'ConverseCommand') {
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    }
    if (this.mode === 'throw') throw new Error('network down');
    const text =
      this.mode === 'bad-json'
        ? 'not json at all'
        : JSON.stringify({
            urgency: 'HIGH',
            risks: ['worsening'],
            unresolved_tasks: ['recheck vitals', 'call doctor'],
            recommended_follow_up: ['notify charge nurse'],
            handoff_summary: 'Needs monitoring.',
            confidence: 0.7,
            evidence_update_ids: [UPDATE_ID],
            requires_human_review: true,
          });
    return { output: { message: { content: [{ text }] } } };
  }
}

let dynamo: FakeDynamo;
let bedrock: FakeBedrock;

beforeEach(() => {
  process.env.BEDROCK_MODEL_ID = 'test-model';
  delete process.env.BEDROCK_MOCK;
  dynamo = new FakeDynamo();
  bedrock = new FakeBedrock();
  dynamo.seed(keys.update(PATIENT_ID, UPDATE_ID), SEED_UPDATE as unknown as Record<string, unknown>);
  setDynamo(dynamo as unknown as Parameters<typeof setDynamo>[0]);
  setBedrock(bedrock as unknown as Parameters<typeof setBedrock>[0]);
});

function event(): APIGatewayProxyEventV2 {
  return {
    headers: { 'x-demo-role': 'charge-nurse', 'x-demo-user': 'Sam' },
    pathParameters: { id: UPDATE_ID },
    queryStringParameters: { patientId: PATIENT_ID },
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

function originalUpdateUntouched(d: FakeDynamo): boolean {
  const stored = d.store.get(`PATIENT#${PATIENT_ID}|UPDATE#${UPDATE_ID}`);
  return stored?.text === SEED_UPDATE.text;
}

test('success: stores analysis separately, creates pending recs, audits, never touches original', async () => {
  const res = await handler(event());
  assert.equal(res.statusCode, 200);

  const body = JSON.parse(res.body as string) as ProcessUpdateResult;
  assert.equal(body.status, 'ok');
  if (body.status !== 'ok') return;

  // Analysis is stored under ANALYSIS#, not overwriting the UPDATE# item.
  const analysisWrites = dynamo.puts.filter((p) => String(p.SK).startsWith('ANALYSIS#'));
  assert.equal(analysisWrites.length, 1);
  assert.ok(originalUpdateUntouched(dynamo), 'original update text must be unchanged');

  // Two unresolved tasks -> two pending recommendations (not auto-applied).
  assert.equal(body.recommendations.length, 2);
  assert.ok(body.recommendations.every((r) => r.status === 'pending'));

  // No task was created automatically.
  const taskWrites = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#'));
  assert.equal(taskWrites.length, 0, 'no assignment should be created automatically');

  // Audit includes a bedrock-called entry.
  const audits = dynamo.puts.filter((p) => p.PK === 'AUDIT');
  assert.ok(audits.some((a) => a.action === 'bedrock-called'));
  assert.ok(audits.some((a) => a.action === 'recommendation-generated'));

  assert.equal(body.analysis.requires_human_review, true);
});

test('invalid JSON: preserves update, stores AI error, no assignment, 502 + fallback message', async () => {
  bedrock.mode = 'bad-json';
  const res = await handler(event());
  assert.equal(res.statusCode, 502);

  const body = JSON.parse(res.body as string) as ProcessUpdateResult;
  assert.equal(body.status, 'ai-unavailable');
  if (body.status !== 'ai-unavailable') return;

  assert.equal(body.error.reason, 'invalid-json');
  assert.ok(body.message.length > 0, 'a clear fallback message is returned');
  assert.equal(body.update.text, SEED_UPDATE.text, 'original update returned intact');
  assert.ok(originalUpdateUntouched(dynamo));

  // AI error persisted; no analysis, no recommendation, no task.
  assert.equal(dynamo.puts.filter((p) => String(p.SK).startsWith('AIERROR#')).length, 1);
  assert.equal(dynamo.puts.filter((p) => String(p.SK).startsWith('ANALYSIS#')).length, 0);
  assert.equal(dynamo.puts.filter((p) => String(p.PK).startsWith('REC#')).length, 0);
  assert.equal(dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#')).length, 0);

  const audits = dynamo.puts.filter((p) => p.PK === 'AUDIT');
  assert.ok(audits.some((a) => a.action === 'ai-processing-failed'));
});

test('bedrock unavailable: records bedrock-unavailable error, update preserved', async () => {
  bedrock.mode = 'throw';
  const res = await handler(event());
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body as string) as ProcessUpdateResult;
  assert.equal(body.status, 'ai-unavailable');
  if (body.status !== 'ai-unavailable') return;
  assert.equal(body.error.reason, 'bedrock-unavailable');
  assert.ok(originalUpdateUntouched(dynamo));
});

test('missing patientId query param -> 400', async () => {
  const e = event();
  (e as { queryStringParameters?: unknown }).queryStringParameters = {};
  const res = await handler(e);
  assert.equal(res.statusCode, 400);
});
