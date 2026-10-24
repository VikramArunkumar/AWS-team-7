/**
 * CareBridge MVP acceptance tests.
 *
 * Covers the ten required scenarios end-to-end against the REAL handlers, with
 * DynamoDB and Bedrock mocked. The real Bedrock API is never called.
 *
 *  1. A nurse can submit an update
 *  2. The original update is preserved
 *  3. Bedrock output is stored separately
 *  4. Invalid Bedrock output does not create a task
 *  5. Bedrock failure does not lose the nurse update
 *  6. Only a charge nurse can approve a recommendation
 *  7. Approval creates an audit record
 *  8. Rejection does not create an assignment
 *  9. Overdue tasks appear on the dashboard
 * 10. Policy responses include citations or a no-result message
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { setClient as setDynamo } from './lib/dynamo.ts';
import { setClient as setBedrock } from './lib/bedrock.ts';
import { FakeDynamo } from './test-support/fakeDynamo.ts';
import { handler as updatesHandler } from './handlers/updates.ts';
import { handler as processHandler } from './handlers/process.ts';
import { handler as recommendationsHandler } from './handlers/recommendations.ts';
import { handler as policyHandler } from './handlers/policy.ts';
import type {
  DecisionResponse,
  NurseUpdate,
  PolicyAnswer,
  ProcessUpdateResult,
} from './lib/types.ts';
import { buildDashboardCounts } from './test-support/dashboard.ts';

// --- Fakes ----------------------------------------------------------------

/** Switchable Bedrock Converse fake. Never calls AWS. */
class FakeBedrock {
  mode: 'valid' | 'bad-json' | 'throw' = 'valid';
  lastUpdateId = 'U';

  async send(command: { constructor: { name: string } }): Promise<unknown> {
    if (command.constructor.name !== 'ConverseCommand') {
      throw new Error('Unexpected command');
    }
    if (this.mode === 'throw') throw new Error('bedrock down');
    const text =
      this.mode === 'bad-json'
        ? 'this is not json'
        : JSON.stringify({
            urgency: 'CRITICAL',
            risks: ['missed dose during outage'],
            unresolved_tasks: ['Confirm and administer overdue antibiotic per existing order.'],
            recommended_follow_up: ['Recheck vitals in 30m'],
            handoff_summary: 'Needs prompt human review of medication timing.',
            confidence: 0.72,
            evidence_update_ids: [this.lastUpdateId],
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
  process.env.POLICY_MOCK = '1';
  dynamo = new FakeDynamo();
  bedrock = new FakeBedrock();
  setDynamo(dynamo as unknown as Parameters<typeof setDynamo>[0]);
  setBedrock(bedrock as unknown as Parameters<typeof setBedrock>[0]);
});

// --- Event builders -------------------------------------------------------

const NURSE = { 'x-demo-role': 'nurse', 'x-demo-user': 'Nurse-A' };
const CHARGE = { 'x-demo-role': 'charge-nurse', 'x-demo-user': 'Charge-Nurse-1' };

function ev(
  method: string,
  opts: {
    headers?: Record<string, string>;
    body?: unknown;
    path?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: opts.headers ?? {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

// --- Helpers that exercise the real flow ----------------------------------

async function submitUpdate(text: string, patientId = 'P-1002'): Promise<NurseUpdate> {
  const res = await updatesHandler(
    ev('POST', { headers: NURSE, body: { patientId, text }, query: { patientId } }),
  );
  assert.equal(res.statusCode, 201, 'submit should return 201');
  return JSON.parse(res.body as string) as NurseUpdate;
}

async function processUpdate(u: NurseUpdate): Promise<ProcessUpdateResult> {
  bedrock.lastUpdateId = u.updateId;
  const res = await processHandler(
    ev('POST', { headers: CHARGE, path: { id: u.updateId }, query: { patientId: u.patientId } }),
  );
  return JSON.parse(res.body as string) as ProcessUpdateResult;
}

function originalStoredText(u: NurseUpdate): unknown {
  return dynamo.store.get(`PATIENT#${u.patientId}|UPDATE#${u.updateId}`)?.text;
}

// --- Scenario 1 -----------------------------------------------------------

test('1. a nurse can submit an update', async () => {
  const u = await submitUpdate('Patient febrile, antibiotic missed during outage.');
  assert.ok(u.updateId, 'update has an id');
  assert.equal(u.authorRole, 'nurse');
  assert.equal(u.authorName, 'Nurse-A');
  // Readable back via GET.
  const list = await updatesHandler(
    ev('GET', { headers: NURSE, query: { patientId: u.patientId } }),
  );
  const body = JSON.parse(list.body as string) as { updates: NurseUpdate[] };
  assert.equal(body.updates.length, 1);
  assert.equal(body.updates[0]?.updateId, u.updateId);
});

// --- Scenario 2 -----------------------------------------------------------

test('2. the original update is preserved after processing', async () => {
  const text = 'ORIGINAL verbatim text that must never change.';
  const u = await submitUpdate(text);
  await processUpdate(u);
  assert.equal(originalStoredText(u), text, 'stored UPDATE# text is unchanged');
  // The update item itself was written exactly once (no overwrite).
  const updateWrites = dynamo.puts.filter(
    (p) => p.PK === `PATIENT#${u.patientId}` && String(p.SK).startsWith('UPDATE#'),
  );
  assert.equal(updateWrites.length, 1);
});

// --- Scenario 3 -----------------------------------------------------------

test('3. Bedrock output is stored separately from the update', async () => {
  const u = await submitUpdate('Needs analysis.');
  const result = await processUpdate(u);
  assert.equal(result.status, 'ok');
  // Analysis stored under ANALYSIS#, not on the UPDATE# item.
  const analysisWrites = dynamo.puts.filter((p) => String(p.SK).startsWith('ANALYSIS#'));
  assert.equal(analysisWrites.length, 1);
  assert.equal(analysisWrites[0]?.updateId, u.updateId, 'analysis references the update by id');
  const updateItem = dynamo.store.get(`PATIENT#${u.patientId}|UPDATE#${u.updateId}`);
  assert.equal(updateItem?.risks, undefined, 'no AI fields leaked onto the original update');
});

// --- Scenario 4 -----------------------------------------------------------

test('4. invalid Bedrock output does not create a task', async () => {
  bedrock.mode = 'bad-json';
  const u = await submitUpdate('Will produce invalid AI output.');
  const result = await processUpdate(u);
  assert.equal(result.status, 'ai-unavailable');
  assert.equal(dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#')).length, 0);
  assert.equal(dynamo.puts.filter((p) => String(p.PK).startsWith('REC#')).length, 0);
  assert.equal(dynamo.puts.filter((p) => String(p.SK).startsWith('ANALYSIS#')).length, 0);
});

// --- Scenario 5 -----------------------------------------------------------

test('5. Bedrock failure does not lose the nurse update', async () => {
  bedrock.mode = 'throw';
  const text = 'Must survive a Bedrock outage.';
  const u = await submitUpdate(text);
  const result = await processUpdate(u);
  assert.equal(result.status, 'ai-unavailable');
  if (result.status !== 'ai-unavailable') return;
  assert.equal(result.update.text, text, 'original returned intact in the response');
  assert.equal(originalStoredText(u), text, 'original still stored intact');
  assert.ok(result.message.length > 0, 'a fallback message is provided');
});

// --- Scenarios 6, 7 (approve) --------------------------------------------

async function seedPendingRecommendation(): Promise<string> {
  const u = await submitUpdate('Generates a recommendation.');
  const result = await processUpdate(u);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') throw new Error('expected ok');
  const recId = result.recommendations[0]?.recId;
  assert.ok(recId, 'a pending recommendation was created');
  return recId!;
}

test('6. only a charge nurse can approve a recommendation', async () => {
  const recId = await seedPendingRecommendation();

  // A nurse is forbidden (403) and no task is created.
  const beforeTasks = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#')).length;
  const denied = await recommendationsHandler(
    ev('POST', { headers: NURSE, path: { id: recId }, body: { decision: 'approve' } }),
  );
  assert.equal(denied.statusCode, 403);
  const afterTasks = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#')).length;
  assert.equal(afterTasks, beforeTasks, 'no task created by the forbidden call');

  // The charge nurse succeeds.
  const okRes = await recommendationsHandler(
    ev('POST', { headers: CHARGE, path: { id: recId }, body: { decision: 'approve' } }),
  );
  assert.equal(okRes.statusCode, 200);
  const body = JSON.parse(okRes.body as string) as DecisionResponse;
  assert.equal(body.recommendation.status, 'approved');
  assert.ok(body.task, 'approval creates a task');
});

test('7. approval creates an audit record', async () => {
  const recId = await seedPendingRecommendation();
  await recommendationsHandler(
    ev('POST', { headers: CHARGE, path: { id: recId }, body: { decision: 'approve' } }),
  );
  const audits = dynamo.puts.filter((p) => p.PK === 'AUDIT');
  assert.ok(
    audits.some((a) => a.action === 'recommendation-approved'),
    'an approval audit entry was written',
  );
  assert.ok(
    audits.some((a) => a.action === 'task-created'),
    'a task-created audit entry was written',
  );
});

// --- Scenario 8 -----------------------------------------------------------

test('8. rejection does not create an assignment', async () => {
  const recId = await seedPendingRecommendation();
  const before = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#')).length;
  const res = await recommendationsHandler(
    ev('POST', { headers: CHARGE, path: { id: recId }, body: { decision: 'reject' } }),
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body as string) as DecisionResponse;
  assert.equal(body.recommendation.status, 'rejected');
  assert.equal(body.task, undefined, 'no task on the response');
  const after = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#')).length;
  assert.equal(after, before, 'no task persisted on rejection');
  const audits = dynamo.puts.filter((p) => p.PK === 'AUDIT');
  assert.ok(audits.some((a) => a.action === 'recommendation-rejected'));
  assert.ok(!audits.some((a) => a.action === 'task-created'));
});

// --- Scenario 9 -----------------------------------------------------------

test('9. overdue tasks appear on the dashboard counts', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const counts = buildDashboardCounts({
    tasks: [
      { status: 'open', dueAt: past }, // overdue
      { status: 'open', dueAt: future }, // not overdue
      { status: 'done', dueAt: past }, // completed -> not counted
      { status: 'in-progress' }, // no due date
    ],
  });
  assert.equal(counts.overdueTasks, 1, 'exactly one overdue task is surfaced');
  assert.equal(counts.unresolvedTasks, 3, 'open + in-progress count as unresolved');
});

// --- Scenario 10 ----------------------------------------------------------

test('10. policy responses include citations or a no-result message', async () => {
  // Known topic -> grounded answer with at least one citation.
  const known = await policyHandler(
    ev('POST', { headers: NURSE, body: { question: 'What do I do during an EHR outage?' } }),
  );
  const knownBody = JSON.parse(known.body as string) as PolicyAnswer;
  assert.equal(knownBody.hasSupport, true);
  assert.ok(knownBody.citations.length >= 1, 'a citation is present');

  // Unknown topic -> no-result message, no fabricated citation.
  const unknown = await policyHandler(
    ev('POST', { headers: NURSE, body: { question: 'what time is the cafeteria open?' } }),
  );
  const unknownBody = JSON.parse(unknown.body as string) as PolicyAnswer;
  assert.equal(unknownBody.hasSupport, false);
  assert.equal(unknownBody.citations.length, 0);
  assert.ok(
    unknownBody.recommendation && unknownBody.recommendation.length > 0,
    'a no-result recommendation is provided',
  );
});

// --- Human-approval boundary (Bedrock may only recommend) -----------------

test('11. Bedrock processing never creates an assignment directly — only a recommendation', async () => {
  const u = await submitUpdate('Antibiotic missed during outage; needs action.');
  const result = await processUpdate(u);

  // Successful AI analysis produces a PENDING recommendation...
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.ok(result.recommendations.length >= 1, 'a recommendation is produced');
  assert.ok(
    result.recommendations.every((r) => r.status === 'pending'),
    'every recommendation starts pending (not applied)',
  );

  // ...but writes ZERO tasks. The AI cannot assign work on its own.
  const tasksAfterProcessing = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#'));
  assert.equal(tasksAfterProcessing.length, 0, 'Bedrock processing creates no TASK# records');

  // A task only exists after an explicit charge-nurse approval.
  const recId = result.recommendations[0]!.recId;
  const approved = await recommendationsHandler(
    ev('POST', { headers: CHARGE, path: { id: recId }, body: { decision: 'approve' } }),
  );
  assert.equal(approved.statusCode, 200);
  const body = JSON.parse(approved.body as string) as DecisionResponse;
  assert.ok(body.task, 'the assignment is created only upon human approval');
  assert.equal(body.task?.recId, recId, 'the task traces back to the approved recommendation');

  const tasksAfterApproval = dynamo.puts.filter((p) => String(p.PK).startsWith('TASK#'));
  assert.equal(tasksAfterApproval.length, 1, 'exactly one task, created by the human decision');
});
