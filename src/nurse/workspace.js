// Pure helpers for the API-backed nurse workspace (src/NurseView.jsx).
// No React here so the rules can be unit-tested in Node.

export const TASK_ACTIONS = Object.freeze([
  { status: 'Completed', label: 'Mark complete', primary: true },
  { status: 'Delayed', label: 'Report delay' },
  { status: 'Unable to complete', label: 'Unable to complete' },
]);

// The backend's update.processing values, in plain language. Every label
// starts with "Saved" because the update is stored before any AI step runs.
const PROCESSING_LABELS = {
  not_processed: 'Saved · AI summary not run yet',
  pending: 'Saved · AI summary in progress',
  processed: 'Saved · AI summary available to the charge nurse',
  failed: 'Saved · AI processing failed; your original update is kept',
};

export function processingLabel(processing) {
  return PROCESSING_LABELS[processing] ?? 'Saved';
}

export function isTaskOverdue(task, now) {
  return Boolean(task.dueAt) && task.status !== 'Completed' && Date.parse(task.dueAt) < now;
}

export function isPatientUnverified(patient, now, freshnessMinutes = 60) {
  if (!patient.verifiedAt) return true;
  return now - Date.parse(patient.verifiedAt) > freshnessMinutes * 60_000;
}

/** Open work first, then by due time (tasks without a due time last). */
export function sortTasks(tasks) {
  const due = (t) => (t.dueAt ? Date.parse(t.dueAt) : Number.POSITIVE_INFINITY);
  return [...tasks].sort((a, b) => (a.status === 'Completed') - (b.status === 'Completed') || due(a) - due(b));
}

/** Replace a record by id, or add it to the front when it is new. */
export function upsertById(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [item, ...list];
  const next = [...list];
  next[index] = item;
  return next;
}

/** One id per submission attempt, reused on retry so the backend can de-duplicate. */
export function newRequestId() {
  return globalThis.crypto.randomUUID();
}

export function listOrNotRecorded(value) {
  return Array.isArray(value) && value.length ? value.join(', ') : 'Not recorded';
}

/** Turn an API error into a message that says plainly whether the update was saved. */
export function saveErrorMessage(error, { correcting = false } = {}) {
  const what = correcting ? 'Your correction was not saved.' : 'Your update was not saved.';
  if (error?.code === 'incident_closed') return `${what} The incident is closed.`;
  if (error?.code === 'network_error') return `${what} CareBridge could not be reached. Your text is still here; try again.`;
  return `${what} ${error?.message ?? 'Try again.'} Your text is still here.`;
}
