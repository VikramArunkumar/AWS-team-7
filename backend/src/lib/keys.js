// Single-table key schema for CareBridge.
//
// Every record belongs to an incident and lives under one partition
// (PK = INCIDENT#<id>). The sort key prefix identifies the entity type, which
// keeps patient data, updates, tasks, AI recommendations, and audit history
// logically separate within the same table (NFR-27).
//
//   PK                    SK                         entity
//   ------------------------------------------------------------------
//   INCIDENT#<id>         META                       incident metadata
//   INCIDENT#<id>         PATIENT#<patientId>        patient continuity profile
//   INCIDENT#<id>         UPDATE#<updateId>          nurse update (original source)
//   INCIDENT#<id>         TASK#<taskId>              task
//   INCIDENT#<id>         REC#<recId>                AI recommendation (proposed/approved/rejected)
//   INCIDENT#<id>         AUDIT#<isoTs>#<uuid>       append-only audit event
//   USER#<userId>         PROFILE                    user profile and role
//
// GSI1 provides actor-scoped lookups, e.g. a nurse's assigned tasks (FR-38):
//   GSI1PK = INCIDENT#<id>#NURSE#<nurseId>, GSI1SK = TASK#<taskId>

export const ENTITY = {
  INCIDENT: 'INCIDENT',
  PATIENT: 'PATIENT',
  UPDATE: 'UPDATE',
  TASK: 'TASK',
  REC: 'REC',
  AUDIT: 'AUDIT',
  USER: 'USER',
};

export const incidentPk = (incidentId) => `INCIDENT#${incidentId}`;

export const incidentMetaKey = (incidentId) => ({
  PK: incidentPk(incidentId),
  SK: 'META',
});

export const patientKey = (incidentId, patientId) => ({
  PK: incidentPk(incidentId),
  SK: `PATIENT#${patientId}`,
});

export const updateKey = (incidentId, updateId) => ({
  PK: incidentPk(incidentId),
  SK: `UPDATE#${updateId}`,
});

export const taskKey = (incidentId, taskId) => ({
  PK: incidentPk(incidentId),
  SK: `TASK#${taskId}`,
});

export const recommendationKey = (incidentId, recId) => ({
  PK: incidentPk(incidentId),
  SK: `REC#${recId}`,
});

// Audit sort keys are time-ordered and unique so events never collide or mutate.
export const auditKey = (incidentId, isoTs, uuid) => ({
  PK: incidentPk(incidentId),
  SK: `AUDIT#${isoTs}#${uuid}`,
});

export const userKey = (userId) => ({
  PK: `USER#${userId}`,
  SK: 'PROFILE',
});

// GSI1 attributes for a task, enabling "tasks assigned to nurse" queries.
export const taskGsi1 = (incidentId, nurseId, taskId) => ({
  GSI1PK: `INCIDENT#${incidentId}#NURSE#${nurseId}`,
  GSI1SK: `TASK#${taskId}`,
});
