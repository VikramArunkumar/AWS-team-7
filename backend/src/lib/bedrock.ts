/**
 * Bedrock service (task 3.1).
 *
 * Calls the Amazon Bedrock Converse API via the AWS SDK to analyze a single
 * nurse update, and returns a strictly-validated analysis payload. The model id
 * is read from the BEDROCK_MODEL_ID environment variable.
 *
 * Safety: the system prompt forbids diagnosis, prescription, medication-order
 * changes, and autonomous clinical decisions. The model must always set
 * requires_human_review = true. All output is advisory.
 *
 * Failure contract: this module throws a typed `BedrockError` for unavailability,
 * invalid JSON, or schema-validation failures. It never persists anything and
 * never mutates the original update — the caller decides how to record the error.
 *
 * Set BEDROCK_MOCK=1 to return a canned, schema-valid payload for offline dev.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  BedrockAnalysisInput,
  BedrockAnalysisPayload,
  UrgencyLevel,
} from './types.ts';

// Env is read at call time (not module load) so configuration and tests behave
// predictably regardless of import order.
function modelId(): string {
  return process.env.BEDROCK_MODEL_ID ?? '';
}
function fallbackModelId(): string {
  return process.env.BEDROCK_FALLBACK_MODEL_ID ?? '';
}
function isMock(): boolean {
  return process.env.BEDROCK_MOCK === '1';
}

export type BedrockFailureReason =
  | 'invalid-json'
  | 'schema-validation'
  | 'bedrock-unavailable'
  | 'unknown';

export class BedrockError extends Error {
  readonly reason: BedrockFailureReason;
  constructor(reason: BedrockFailureReason, message: string) {
    super(message);
    this.name = 'BedrockError';
    this.reason = reason;
  }
}

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({});
  return client;
}

/** Test seam: inject a mock runtime client. */
export function setClient(c: BedrockRuntimeClient): void {
  client = c;
}

const URGENCY_LEVELS: readonly UrgencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const SYSTEM_PROMPT = `You are a clinical continuity-of-care assistant used during a hospital EHR outage.
You NEVER diagnose patients, NEVER prescribe treatment, NEVER change medication orders, and NEVER make autonomous clinical decisions.
You extract and summarize information from nurse notes so a human charge nurse can prioritize and decide.
Anything implying a clinical decision must be surfaced as an unresolved task for a human to review.
You MUST return ONLY a single JSON object, no prose, no markdown fences, matching exactly this schema:
{
  "urgency": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "risks": string[],
  "unresolved_tasks": string[],
  "recommended_follow_up": string[],
  "handoff_summary": string,
  "confidence": number,            // between 0 and 1
  "evidence_update_ids": string[], // ids of updates you used as evidence
  "requires_human_review": true    // always true
}`;

function buildUserMessage(input: BedrockAnalysisInput): string {
  const recent = input.recentUpdates
    .map((u) => `- [${u.updateId} @ ${u.createdAt} by ${u.authorName}]: ${u.text}`)
    .join('\n');
  const tasks = input.existingTasks
    .map((t) => `- [${t.taskId}] (${t.status}, ${t.priority}) ${t.description}`)
    .join('\n');

  return [
    `ACTIVE_OUTAGE_TYPE: ${input.outageType ?? 'none'}`,
    '',
    'PATIENT_CONTINUITY_PROFILE:',
    `  id: ${input.patientProfile.patientId}`,
    `  name: ${input.patientProfile.name}`,
    `  room: ${input.patientProfile.room}`,
    `  continuity: ${input.patientProfile.continuity ?? 'n/a'}`,
    '',
    'ORIGINAL_NURSE_UPDATE:',
    `  id: ${input.update.updateId}`,
    `  by: ${input.update.authorName} (${input.update.authorRole})`,
    `  at: ${input.update.createdAt}`,
    `  text: ${input.update.text}`,
    '',
    'RECENT_RELATED_UPDATES:',
    recent || '  (none)',
    '',
    'EXISTING_UNRESOLVED_TASKS:',
    tasks || '  (none)',
    '',
    'Analyze the ORIGINAL_NURSE_UPDATE in context and return the JSON object.',
  ].join('\n');
}

/** Pull the first text block out of a Converse response. */
function extractText(output: unknown): string {
  const content = (output as { output?: { message?: { content?: Array<{ text?: string }> } } })
    ?.output?.message?.content;
  if (!Array.isArray(content)) {
    throw new BedrockError('invalid-json', 'Bedrock returned no message content.');
  }
  const text = content.map((c) => c.text ?? '').join('').trim();
  if (!text) throw new BedrockError('invalid-json', 'Bedrock returned empty text.');
  return text;
}

/** Tolerate an accidental ```json fence, then JSON.parse. */
function parseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new BedrockError('invalid-json', 'Bedrock response was not valid JSON.');
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Strictly validate the parsed object against the required schema. */
export function validateAnalysis(value: unknown): BedrockAnalysisPayload {
  if (typeof value !== 'object' || value === null) {
    throw new BedrockError('schema-validation', 'Analysis must be a JSON object.');
  }
  const v = value as Record<string, unknown>;

  if (!URGENCY_LEVELS.includes(v.urgency as UrgencyLevel)) {
    throw new BedrockError('schema-validation', 'Field "urgency" is invalid.');
  }
  if (!isStringArray(v.risks)) {
    throw new BedrockError('schema-validation', 'Field "risks" must be a string array.');
  }
  if (!isStringArray(v.unresolved_tasks)) {
    throw new BedrockError('schema-validation', 'Field "unresolved_tasks" must be a string array.');
  }
  if (!isStringArray(v.recommended_follow_up)) {
    throw new BedrockError(
      'schema-validation',
      'Field "recommended_follow_up" must be a string array.',
    );
  }
  if (typeof v.handoff_summary !== 'string' || v.handoff_summary.trim() === '') {
    throw new BedrockError('schema-validation', 'Field "handoff_summary" must be a non-empty string.');
  }
  if (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) {
    throw new BedrockError('schema-validation', 'Field "confidence" must be a number in [0, 1].');
  }
  if (!isStringArray(v.evidence_update_ids)) {
    throw new BedrockError(
      'schema-validation',
      'Field "evidence_update_ids" must be a string array.',
    );
  }
  // Human-in-the-loop invariant: never allow this to be false.
  if (v.requires_human_review !== true) {
    throw new BedrockError('schema-validation', 'Field "requires_human_review" must be true.');
  }

  return {
    urgency: v.urgency as UrgencyLevel,
    risks: v.risks,
    unresolved_tasks: v.unresolved_tasks,
    recommended_follow_up: v.recommended_follow_up,
    handoff_summary: v.handoff_summary,
    confidence: v.confidence,
    evidence_update_ids: v.evidence_update_ids,
    requires_human_review: true,
  };
}

function mockPayload(input: BedrockAnalysisInput): BedrockAnalysisPayload {
  return {
    urgency: 'HIGH',
    risks: ['Synthetic: condition may be worsening (mock output).'],
    unresolved_tasks: ['Synthetic: recheck vitals within 1 hour (mock output).'],
    recommended_follow_up: ['Synthetic: notify charge nurse (mock output).'],
    handoff_summary: `Mock handoff summary for ${input.patientProfile.name}.`,
    confidence: 0.5,
    evidence_update_ids: [input.update.updateId],
    requires_human_review: true,
  };
}

async function converseOnce(modelId: string, userMessage: string): Promise<string> {
  const req: ConverseCommandInput = {
    modelId,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { temperature: 0.1, maxTokens: 1024 },
  };
  try {
    const res = await getClient().send(new ConverseCommand(req));
    return extractText(res);
  } catch (err) {
    if (err instanceof BedrockError) throw err; // from extractText
    throw new BedrockError('bedrock-unavailable', 'Bedrock Converse call failed.');
  }
}

/**
 * Analyze a single nurse update. Returns a validated payload or throws
 * BedrockError. One retry with the fallback model is attempted on
 * unavailability if BEDROCK_FALLBACK_MODEL_ID is set.
 */
export async function analyzeUpdate(
  input: BedrockAnalysisInput,
): Promise<{ payload: BedrockAnalysisPayload; model: string }> {
  if (isMock()) {
    return { payload: mockPayload(input), model: 'mock' };
  }
  const primary = modelId();
  if (!primary) {
    throw new BedrockError('bedrock-unavailable', 'BEDROCK_MODEL_ID is not configured.');
  }

  const userMessage = buildUserMessage(input);
  const fallback = fallbackModelId();

  let text: string;
  try {
    text = await converseOnce(primary, userMessage);
  } catch (err) {
    if (err instanceof BedrockError && err.reason === 'bedrock-unavailable' && fallback) {
      text = await converseOnce(fallback, userMessage);
      const payload = validateAnalysis(parseJson(text));
      return { payload, model: fallback };
    }
    throw err;
  }

  const payload = validateAnalysis(parseJson(text));
  return { payload, model: primary };
}
