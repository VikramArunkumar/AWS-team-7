/**
 * Dashboard data provider.
 *
 * For the MVP demo this serves synthetic, in-memory data and applies decisions
 * locally so the charge nurse dashboard is fully demoable without a deployed
 * backend. Each function is shaped to be swapped for a real API call later
 * (GET /outage, GET /issues, GET /tasks, POST /recommendations/{id}/decision,
 * POST /tasks/{id}/assign). All patient data here is synthetic.
 */

import type {
  AuditEntry,
  DashboardData,
  PolicyAnswer,
  RecommendationContent,
  Task,
} from '../types.ts';
import { buildDemoData } from './demoFixture.ts';

export type Decision = 'approve' | 'reject' | 'modify-approve';

/** Append a synthetic audit entry (mirrors the backend audit trail). */
function audit(action: string, targetId: string, actorName = 'Charge-Nurse-1'): void {
  const entry: AuditEntry = {
    entryId: `AUD-${Math.random().toString(36).slice(2, 8)}`,
    actorRole: 'charge-nurse',
    actorName,
    action,
    targetId,
    createdAt: new Date().toISOString(),
  };
  data.audit.push(entry);
}

// In-memory demo store, initialized from the shared synthetic fixture.
let data: DashboardData = buildDemoData();

export async function loadDashboard(): Promise<DashboardData> {
  // Return a structural clone so callers can't mutate the store directly.
  return structuredClone(data);
}

/**
 * Restore the original synthetic demo state. Use this to reset before recording
 * the hackathon video (also wired to the "Reset demo" button in the dashboard).
 */
export async function resetDemo(): Promise<void> {
  data = buildDemoData();
}

/**
 * Apply a decision to a recommendation. Approve / modify-approve creates a task;
 * reject does not. Mirrors POST /recommendations/{id}/decision semantics.
 */
export async function decide(
  recId: string,
  decision: Decision,
  content?: RecommendationContent,
): Promise<void> {
  const item = data.queue.find((q) => q.recommendation.recId === recId);
  if (!item) return;

  if (decision === 'reject') {
    item.recommendation.status = 'rejected';
    audit('recommendation-rejected', recId);
    return;
  }

  if (decision === 'modify-approve' && content) {
    item.recommendation.modifiedContent = content;
    audit('recommendation-modified', recId);
  }
  item.recommendation.status = 'approved';
  audit('recommendation-approved', recId);

  const applied = item.recommendation.modifiedContent ?? item.recommendation.content;
  const t: Task = {
    taskId: `T-${Math.random().toString(36).slice(2, 8)}`,
    patientId: item.recommendation.patientId,
    assignee: applied.suggestedAssignee ?? 'Unassigned',
    description: applied.description,
    priority: item.recommendation.priority,
    status: 'open',
    recId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.tasks.push(t);
  audit('task-created', t.taskId);
}

/** Assign or reassign a task. Mirrors POST /tasks/{id}/assign. */
export async function assignTask(taskId: string, assignee: string): Promise<void> {
  const t = data.tasks.find((x) => x.taskId === taskId);
  if (t) {
    t.assignee = assignee;
    t.updatedAt = new Date().toISOString();
    audit('task-assigned', taskId);
  }
}

/**
 * Ask the policy assistant. Mirrors POST /policy/ask and the backend's
 * anti-fabrication contract: returns a grounded answer with a citation only for
 * topics backed by a synthetic policy document; otherwise reports that no
 * matching policy was found and recommends contacting the charge nurse.
 */
const POLICY_TOPICS: Array<{ match: RegExp; file: string; answer: string }> = [
  {
    match: /ehr|record/,
    file: 'ehr-outage-procedure.md',
    answer:
      'During an EHR outage, continue essential care and capture updates in CareBridge or approved downtime forms using original observation times. The charge nurse declares and later resolves the outage.',
  },
  {
    match: /medication|emar|dose|drug/,
    file: 'medication-system-outage-procedure.md',
    answer:
      'Use the most recent verified medication record to confirm what is due. If prior dose timing cannot be confirmed, do not re-dose; escalate to the charge nurse and prescriber. CareBridge never changes medication orders.',
  },
  {
    match: /escalat|communicat|paging|message/,
    file: 'communication-escalation-procedure.md',
    answer:
      'Follow the fallback communication order (in-person, then unit methods) with the charge nurse as the coordination point. Urgent items go directly to the charge nurse; emergencies use the standard code process.',
  },
  {
    match: /document|paper|chart/,
    file: 'manual-documentation-procedure.md',
    answer:
      'Document on approved downtime forms or in CareBridge with legible, signed, time-stamped entries at the actual observation time. Never erase; append corrections. Reconcile into the EHR on recovery.',
  },
  {
    match: /staff|coverage|ratio|call-out/,
    file: 'staffing-disruption-procedure.md',
    answer:
      'Rebalance assignments by acuity, request float/resource staff, prioritize time-critical care, and escalate to the nursing supervisor if a safe ratio cannot be met. The charge nurse approves every assignment.',
  },
];

export async function askPolicy(question: string): Promise<PolicyAnswer> {
  const q = question.toLowerCase();
  const hit = POLICY_TOPICS.find((t) => t.match.test(q));
  if (!hit) {
    return {
      answer: 'No matching facility policy was found for this question.',
      citations: [],
      hasSupport: false,
      recommendation: 'Please contact the charge nurse or nursing supervisor for guidance.',
    };
  }
  return {
    answer: `${hit.answer} (synthetic policy)`,
    citations: [
      {
        title: hit.file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        s3Uri: `s3://carebridge-policies/${hit.file}`,
        snippet: 'Synthetic policy document excerpt.',
      },
    ],
    hasSupport: true,
  };
}
