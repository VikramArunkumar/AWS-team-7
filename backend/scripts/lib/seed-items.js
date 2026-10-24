// Pure transformation from the frontend's synthetic fixtures (src/data.js) to
// single-table items. Shared by scripts/seed.js and the backend tests so the
// seeded ownership (n1, n2, ...) is exactly what the tests exercise.
// No AWS SDK imports here. Synthetic data only (NFR-10).

// The fixtures name the charge nurse but give her no id. This is the seeded
// application user for that synthetic persona.
export const SEED_CHARGE_NURSES = [{ id: 'c1', displayName: 'Olivia Bennett' }];

const pk = (incidentId) => `INCIDENT#${incidentId}`;

function processingStatus(label) {
  if (label?.includes('failed')) return 'failed';
  if (label?.includes('available')) return 'processed';
  return 'not_processed';
}

/**
 * @returns {{ incidentItems: object[], profileItems: object[] }}
 *   incidentItems: incident META, patients, updates, tasks, recommendations
 *   profileItems:  USER#<id> PROFILE items (without any Cognito binding)
 */
export function buildSeedItems(fixtures, { now = new Date().toISOString() } = {}) {
  const {
    incident, nurses, patients, updates, tasks, recommendations,
  } = fixtures;
  const incidentId = incident.id;
  const incidentItems = [];

  incidentItems.push({
    PK: pk(incidentId), SK: 'META', entity: 'INCIDENT', incidentId,
    type: incident.type, unit: incident.unit, status: 'active',
    startedAt: incident.startedAt, endedAt: null, activatedBy: SEED_CHARGE_NURSES[0].id,
  });

  for (const p of patients) {
    incidentItems.push({
      PK: pk(incidentId), SK: `PATIENT#${p.id}`, entity: 'PATIENT', incidentId,
      id: p.id, name: p.name, age: p.age, room: p.room, nurse: p.nurse,
      priority: p.priority, concern: p.concern, detail: p.detail,
      verifiedAt: p.verifiedAt ?? null, note: p.note, source: p.source,
      // FR-9 continuity profile fields (synthetic).
      allergies: p.allergies ?? [], medications: p.medications ?? [],
      conditions: p.conditions ?? [], carePriorities: p.carePriorities ?? null,
      riskIndicators: p.riskIndicators ?? [],
    });
  }

  // Nurse updates keep their original author ids (n1, n2, ...).
  for (const u of updates) {
    incidentItems.push({
      PK: pk(incidentId), SK: `UPDATE#${u.id}`, entity: 'UPDATE', incidentId,
      id: u.id, patient: u.patient, nurse: u.nurse, createdAt: u.createdAt,
      urgent: Boolean(u.urgent), category: u.category, text: u.text,
      structured: null, editHistory: [],
      processing: processingStatus(u.processing),
    });
  }

  // Tasks keep their assigned nurse ids, with GSI1 for nurse-scoped lookups.
  for (const t of tasks) {
    incidentItems.push({
      PK: pk(incidentId), SK: `TASK#${t.id}`,
      GSI1PK: `INCIDENT#${incidentId}#NURSE#${t.nurse}`, GSI1SK: `TASK#${t.id}`,
      entity: 'TASK', incidentId, id: t.id, patient: t.patient,
      description: t.description, priority: t.priority, nurse: t.nurse,
      dueAt: t.dueAt, status: t.status, creator: t.creator, createdAt: t.createdAt,
    });
  }

  // AI recommendations (proposed, pending human decision).
  for (const r of recommendations) {
    incidentItems.push({
      PK: pk(incidentId), SK: `REC#${r.id}`, entity: 'REC', incidentId,
      id: r.id, patient: r.patient, title: r.title, reason: r.reason,
      sourceUpdateIds: [r.source], aiGenerated: true, status: 'proposed',
      createdAt: now,
    });
  }

  // Application user profiles. Roles here are what provisioning must match;
  // the Cognito binding (cognitoSub) is added only by provision-identity.js.
  const profileItems = [
    ...nurses.map((n) => ({ id: n.id, displayName: n.name, role: 'nurse' })),
    ...SEED_CHARGE_NURSES.map((c) => ({ ...c, role: 'charge_nurse' })),
  ].map((u) => ({
    PK: `USER#${u.id}`, SK: 'PROFILE', entity: 'USER',
    userId: u.id, displayName: u.displayName, role: u.role, createdAt: now,
  }));

  return { incidentItems, profileItems };
}
