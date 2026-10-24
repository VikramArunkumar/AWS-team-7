/**
 * Process-update endpoint (tasks 3.2 + 3.4).
 *
 *   POST /updates/{id}/process?patientId=...
 *
 * Reads the original nurse update plus context (patient profile, recent related
 * updates, active outage type, existing unresolved tasks), calls the Bedrock
 * service, and:
 *   - on success: stores a SEPARATE BedrockAnalysis record (original update
 *     untouched), creates pending recommendations (never auto-applied), and
 *     writes a `bedrock-called` audit entry describing the recommendation;
 *   - on failure (invalid JSON / schema / unavailable): preserves the original
 *     update, stores an AiProcessingError, writes an `ai-processing-failed`
 *     audit entry, creates NO assignment, and returns a clear fallback message.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  getActor,
  HttpError,
  ok,
  requireString,
  withErrorHandling,
  type HttpResult,
} from '../lib/http.ts';
import {
  getItem,
  keys,
  newId,
  putItem,
  queryByPrefix,
  queryGsi1,
  gsi1,
  type StoredItem,
} from '../lib/dynamo.ts';
import { recordAudit } from '../lib/audit.ts';
import { analyzeUpdate, BedrockError } from '../lib/bedrock.ts';
import type {
  AiProcessingError,
  BedrockAnalysis,
  NurseUpdate,
  OutageState,
  Patient,
  ProcessUpdateResult,
  Recommendation,
  Task,
  UrgencyLevel,
} from '../lib/types.ts';

const FALLBACK_MESSAGE =
  'AI processing is temporarily unavailable. The nurse update has been saved and ' +
  'no assignment was created. A charge nurse can retry or triage manually.';

function strip<T>(item: StoredItem): T {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item;
  return rest as T;
}

async function loadUpdate(patientId: string, updateId: string): Promise<NurseUpdate> {
  const item = await getItem<StoredItem & NurseUpdate>(keys.update(patientId, updateId));
  if (!item) throw new HttpError(404, 'Update not found for the given patient.');
  return strip<NurseUpdate>(item);
}

async function loadPatient(patientId: string): Promise<Patient & { continuity?: string }> {
  const item = await getItem<StoredItem & Patient & { continuity?: string }>(
    keys.patient(patientId),
  );
  // Patient roster may not be seeded in all environments; fall back to a stub.
  if (!item) return { patientId, name: `Patient ${patientId}`, room: 'unknown' };
  return strip<Patient & { continuity?: string }>(item);
}

async function loadRecentUpdates(patientId: string, excludeId: string): Promise<NurseUpdate[]> {
  const items = await queryByPrefix<StoredItem & NurseUpdate>(
    `PATIENT#${patientId}`,
    'UPDATE#',
    true,
  );
  return items
    .map((i) => strip<NurseUpdate>(i))
    .filter((u) => u.updateId !== excludeId)
    .slice(-5);
}

async function loadOpenTasks(patientId: string): Promise<Task[]> {
  const items = await queryGsi1<StoredItem & Task>('TASK_STATUS#open', true);
  return items.map((i) => strip<Task>(i)).filter((t) => t.patientId === patientId);
}

async function loadOutageType(): Promise<string | undefined> {
  const item = await getItem<StoredItem & OutageState>(keys.outage());
  if (!item || item.status !== 'active') return undefined;
  return item.incidentType ?? 'EHR outage';
}

/** Map a 4-level urgency to the 3-level recommendation priority. */
function urgencyToPriority(u: UrgencyLevel): Recommendation['priority'] {
  if (u === 'CRITICAL' || u === 'HIGH') return 'high';
  if (u === 'MEDIUM') return 'medium';
  return 'low';
}

function priorityRank(u: UrgencyLevel): number {
  return { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }[u];
}

export const handler = withErrorHandling(
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    const actor = getActor(event); // any authenticated demo role may process
    const updateId = event.pathParameters?.id;
    if (!updateId) throw new HttpError(400, 'Path parameter "id" (updateId) is required.');
    const patientId = requireString(event.queryStringParameters?.patientId, 'patientId');

    const update = await loadUpdate(patientId, updateId);

    const [patientProfile, recentUpdates, existingTasks, outageType] = await Promise.all([
      loadPatient(patientId),
      loadRecentUpdates(patientId, updateId),
      loadOpenTasks(patientId),
      loadOutageType(),
    ]);

    try {
      const { payload, model } = await analyzeUpdate({
        patientProfile,
        update,
        recentUpdates,
        outageType,
        existingTasks,
      });

      // --- Success: store analysis SEPARATELY from the original update. ---
      const analysisId = newId();
      const createdAt = new Date().toISOString();
      const analysis: BedrockAnalysis = {
        analysisId,
        updateId,
        patientId,
        model,
        createdAt,
        ...payload,
      };
      await putItem({ ...keys.analysis(patientId, analysisId), ...analysis });

      // Create pending recommendations (advisory; never auto-applied).
      const recommendations: Recommendation[] = payload.unresolved_tasks.map((desc, idx) => {
        const recId = newId();
        const rec: Recommendation = {
          recId,
          type: 'assignment',
          patientId,
          updateId,
          content: { description: desc },
          priority: urgencyToPriority(payload.urgency),
          priorityRank: priorityRank(payload.urgency) * 100 + idx,
          rationale: `Derived from AI analysis (urgency ${payload.urgency}, confidence ${payload.confidence}).`,
          status: 'pending',
          createdAt,
        };
        return rec;
      });

      for (const rec of recommendations) {
        await putItem({
          ...keys.recommendation(rec.recId),
          ...gsi1.recByStatus('pending', rec.priorityRank, rec.recId),
          ...rec,
        });
        await recordAudit({
          actor,
          action: 'recommendation-generated',
          targetId: rec.recId,
          after: rec,
        });
      }

      // Audit: when Bedrock was called and what it produced.
      await recordAudit({
        actor,
        action: 'bedrock-called',
        targetId: analysisId,
        after: { model, updateId, urgency: payload.urgency, analysis },
      });

      const result: ProcessUpdateResult = { status: 'ok', analysis, recommendations };
      return ok(result);
    } catch (err) {
      // --- Failure: preserve original update, record error, NO assignment. ---
      const reason =
        err instanceof BedrockError ? err.reason : ('unknown' as AiProcessingError['reason']);
      const model = process.env.BEDROCK_MODEL_ID ?? 'unknown';

      const errorId = newId();
      const aiError: AiProcessingError = {
        errorId,
        updateId,
        patientId,
        reason,
        message: FALLBACK_MESSAGE,
        model,
        createdAt: new Date().toISOString(),
      };
      await putItem({ ...keys.aiError(patientId, errorId), ...aiError });

      await recordAudit({
        actor,
        action: 'ai-processing-failed',
        targetId: updateId,
        after: { reason, model, errorId },
      });

      const result: ProcessUpdateResult = {
        status: 'ai-unavailable',
        update, // original, intact
        error: aiError,
        message: FALLBACK_MESSAGE,
      };
      // 502: upstream AI failure, but the update is safe and returned.
      return ok(result, 502);
    }
  },
);
