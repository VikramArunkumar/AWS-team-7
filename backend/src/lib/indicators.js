// Derived indicators shared by the charge nurse dashboard and the nurse
// workspace, so both views flag the same records the same way.

// Prototype freshness window for patient verification (FR-11). This threshold
// is a documented product decision, not something the requirements specify.
export const VERIFICATION_FRESHNESS_MINUTES = 60;

export function isUnverified(verifiedAt, now) {
  if (!verifiedAt) return true;
  return now - Date.parse(verifiedAt) > VERIFICATION_FRESHNESS_MINUTES * 60000;
}

// FR-39: an open task past its due time.
export function isOverdue(task, now) {
  if (!task.dueAt) return false;
  const open = task.status !== 'Completed';
  return open && Date.parse(task.dueAt) < now;
}

// FR-7: elapsed incident time, frozen at endedAt once the incident closes.
export function durationMinutes(incident, now) {
  const end = incident.endedAt ? Date.parse(incident.endedAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(incident.startedAt)) / 60000));
}
