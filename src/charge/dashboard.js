// Pure helpers for the API-backed charge nurse dashboard (src/ChargeDashboard.jsx).
// No React here so the rules can be unit-tested in Node.

import { isTaskOverdue, isPatientUnverified } from '../nurse/workspace.js';

export { isTaskOverdue, isPatientUnverified };

const TONES = ['purple', 'blue', 'peach', 'green', 'pink'];
export const PRIORITIES = ['High', 'Moderate', 'Low'];
// Statuses the API accepts on PATCH .../tasks/{id}; "Unconfirmed" is only the initial state.
export const SETTABLE_STATUSES = ['In progress', 'Completed', 'Delayed', 'Unable to complete'];
export const TASK_FILTERS = ['All statuses', 'Overdue', 'Unconfirmed', 'In progress', 'Delayed', 'Unable to complete', 'Completed'];
export const DUE_CHOICES = [
  { value: '', label: 'No due time' },
  { value: '15', label: 'In 15 minutes' },
  { value: '30', label: 'In 30 minutes' },
  { value: '60', label: 'In 1 hour' },
  { value: '120', label: 'In 2 hours' },
];
const PRIORITY_RANK = { High: 0, Moderate: 1, Low: 2 };

export function initials(name) {
  const parts = String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0].toUpperCase()).join('') || '?';
}

function toneFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

/** Map application user ids to display info. Unknown ids still render. */
export function staffDirectory(staff = []) {
  const byId = new Map(staff.map((s) => [s.userId, {
    id: s.userId, name: s.displayName, role: s.role, initials: initials(s.displayName), tone: toneFor(s.userId),
  }]));
  const personFor = (id) => byId.get(id) ?? {
    id, name: id ? String(id) : 'Unassigned', role: null, initials: id ? initials(id) : '–', tone: '',
  };
  const nurses = [...byId.values()].filter((p) => p.role === 'nurse');
  return { personFor, nurses };
}

export const isTaskOpen = (task) => task.status !== 'Completed';

export function filterPatients(patients, { search = '', filter = 'All patients', nurse = 'all', sort = 'priority', now, freshness, nameOf }) {
  const text = search.toLowerCase();
  return patients.filter((p) => {
    const haystack = `${p.name} ${p.id} ${p.room} ${p.concern ?? ''} ${nameOf(p.nurse)}`.toLowerCase();
    return haystack.includes(text)
      && (nurse === 'all' || p.nurse === nurse)
      && (filter === 'All patients'
        || (filter === 'High priority' && p.priority === 'High')
        || (filter === 'Needs verification' && isPatientUnverified(p, now, freshness)));
  }).sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name)
    : sort === 'room' ? String(a.room).localeCompare(String(b.room))
      : (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)));
}

export function filterTasks(tasks, { search = '', status = 'All statuses', sort = 'due', now, nameOf, patientName }) {
  const text = search.toLowerCase();
  const due = (t) => (t.dueAt ? Date.parse(t.dueAt) : Number.POSITIVE_INFINITY);
  return tasks.filter((t) => `${t.description} ${patientName(t.patient)} ${nameOf(t.nurse)}`.toLowerCase().includes(text)
    && (status === 'All statuses' || t.status === status || (status === 'Overdue' && isTaskOverdue(t, now))))
    .sort((a, b) => (sort === 'priority' ? (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
      : sort === 'patient' ? patientName(a.patient).localeCompare(patientName(b.patient))
        : due(a) - due(b)));
}

/** '' -> null; '30' -> ISO time 30 minutes after now. */
export function dueFromChoice(choice, now) {
  if (choice === '' || choice === null || choice === undefined) return null;
  const minutes = Number(choice);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(now + minutes * 60_000).toISOString();
}

/**
 * Only the fields the charge nurse actually changed, in the API's PATCH shape.
 * form: { assignedNurse, priority, status, due } where due is 'keep' or a DUE_CHOICES value.
 */
export function taskChanges(task, form, now) {
  const patch = {};
  if (form.assignedNurse && form.assignedNurse !== task.nurse) patch.assignedNurse = form.assignedNurse;
  if (form.priority && form.priority !== task.priority) patch.priority = form.priority;
  if (form.status && form.status !== task.status && SETTABLE_STATUSES.includes(form.status)) patch.status = form.status;
  if (form.due !== undefined && form.due !== 'keep') patch.dueAt = dueFromChoice(form.due, now);
  return patch;
}

/** Defaults for approving a recommendation: the patient's nurse and priority. */
export function approvalDefaults(rec, patient, nurses) {
  const assigned = nurses.some((n) => n.id === patient?.nurse) ? patient.nurse : (nurses[0]?.id ?? '');
  return {
    assignedNurse: assigned,
    priority: PRIORITIES.includes(patient?.priority) ? patient.priority : 'Moderate',
    description: rec.title ?? '',
    due: '30',
  };
}

export function sourceUpdatesFor(rec, updates) {
  const ids = Array.isArray(rec.sourceUpdateIds) ? rec.sourceUpdateIds : [];
  return ids.map((id) => ({ id, update: updates.find((u) => u.id === id) ?? null }));
}

/** Message for a failed decision that says whether anything was applied. */
export function decisionErrorMessage(error) {
  if (error?.code === 'already_decided') return 'Another decision was already recorded. The dashboard has been refreshed.';
  if (error?.code === 'network_error' || !error?.status || error.status >= 500) {
    return "CareBridge couldn't confirm the decision. Refresh and check the recommendation before trying again.";
  }
  return `Nothing was applied. ${error?.message ?? 'Try again.'}`;
}

export function aiErrorMessage(error) {
  if (error?.code === 'already_processed') return 'AI review already ran or is running for this update.';
  if (error?.code === 'ai_unavailable') return error.message;
  return `AI review didn't run. ${error?.message ?? 'Try again.'} The original update is unchanged.`;
}
