# Requirements — CareBridge MVP

## Introduction

CareBridge is an AI-driven continuity-of-care system for use during a simulated
hospital EHR outage. When the EHR, medication system, or internal messaging
system is unavailable, a charge nurse must coordinate multiple nurses and
patients. CareBridge preserves patient continuity information, collects nurse
updates, uses Amazon Bedrock to identify risks and unresolved tasks, generates
prioritized handoff summaries, and helps the charge nurse prioritize and assign
work — always with a human approving any consequential action.

This document defines the requirements for an 18-hour hackathon MVP. Requirements
are organized into eleven capabilities. Each requirement is tagged **[MVP]**
(required for the working end-to-end demo) or **[Stretch]** (build only if the
MVP demo is already solid). The guiding priority is a **working end-to-end demo
over completeness**.

### Global safety constraints (apply to every requirement)

- The system MUST NOT diagnose patients, prescribe treatment, change medication
  orders, or make autonomous clinical decisions.
- Every AI output that would create an assignment, escalation, or patient-status
  change MUST be presented as a recommendation requiring explicit human approval.
- All patient data MUST be synthetic.

### Core data-integrity guarantee (applies to every capability)

- The original, raw nurse update text MUST be stored immutably and MUST NEVER be
  overwritten, edited in place, or replaced by AI-generated content. AI output
  (extractions, summaries, recommendations) MUST be stored as separate records
  that reference the original update by id. This guarantee is restated as
  explicit acceptance criteria in Capabilities 4, 5, and 11.

### Demo scenario this spec must support

Activate outage → select two nurse roles → submit updates for different patients
→ store in a shared database → send to Bedrock → extract risks and unresolved
tasks → generate a prioritized summary → display the highest-priority issue →
charge nurse approves/rejects/modifies → create a task after approval → show
audit history → ask a policy question and show the supporting citation.

---

## Capability 1 — Demo authentication and roles

### Requirement 1.1 — Demo role selection **[MVP]**

**User Story:** As a demo participant, I want to select a nurse role when the app
loads, so that the experience and permissions reflect that role.

#### Acceptance Criteria

1. WHEN the app loads THEN the system SHALL present a clearly labeled demo role
   selector offering at least `Nurse` and `Charge Nurse`.
2. WHEN a role is selected THEN the system SHALL capture a role and a named user
   and attribute all subsequent updates and actions to them.
3. WHEN the selector is shown THEN it SHALL be visibly labeled as a demo mechanism
   and NOT real authentication.
4. WHEN no role is selected THEN the system SHALL NOT allow submitting updates or
   taking actions.

### Requirement 1.2 — Role-based permissions **[MVP]**

**User Story:** As a charge nurse, I want only charge nurses to approve or change
recommendations, so that consequential actions are properly authorized.

#### Acceptance Criteria

1. IF the active role is `Nurse` THEN the system SHALL NOT allow approving,
   rejecting, or modifying AI recommendations, nor activating/deactivating an
   outage.
2. IF the active role is `Charge Nurse` THEN the system SHALL allow approving,
   rejecting, or modifying recommendations and managing the outage.
3. WHEN a role lacking permission attempts a restricted action THEN the system
   SHALL reject it with a clear authorization error.

### Requirement 1.3 — Cognito-backed sign-in **[Stretch]**

**User Story:** As a user, I want to sign in with real credentials and role
claims, so that access reflects authenticated identity.

#### Acceptance Criteria

1. WHEN Cognito sign-in is enabled THEN the system SHALL authenticate users and
   derive role from a token claim, replacing the demo selector.
2. This requirement SHALL be implemented only if it does not risk the MVP
   deadline; otherwise the demo role selector (1.1) stands.

---

## Capability 2 — Crisis incident management

### Requirement 2.1 — Activate a simulated outage **[MVP]**

**User Story:** As a charge nurse, I want to activate a simulated EHR outage, so
that the team switches to CareBridge for continuity of care.

#### Acceptance Criteria

1. WHEN a charge nurse activates an outage THEN the system SHALL record an outage
   state of `active` with a start timestamp and the actor.
2. WHEN an outage is active THEN the system SHALL display a clear outage banner to
   all roles.
3. WHEN no outage has ever been activated THEN the system SHALL default to a
   `normal` (inactive) state.

### Requirement 2.2 — Deactivate the outage **[MVP]**

**User Story:** As a charge nurse, I want to deactivate the outage when the EHR is
back, so that the team knows normal operations have resumed.

#### Acceptance Criteria

1. WHEN a charge nurse deactivates the outage THEN the system SHALL record the
   state as `resolved` with an end timestamp and the actor.
2. WHEN the outage is resolved THEN the banner SHALL reflect the resolved state.

### Requirement 2.3 — Incident metadata **[Stretch]**

**User Story:** As a charge nurse, I want to label the incident (type, affected
systems, note), so that the context of the outage is recorded.

#### Acceptance Criteria

1. WHEN activating an outage THEN the system MAY capture an incident type,
   affected systems, and a free-text note.
2. WHEN incident metadata exists THEN it SHALL be shown alongside the banner.

---

## Capability 3 — Synthetic patient continuity profiles

### Requirement 3.1 — Synthetic patient roster **[MVP]**

**User Story:** As a charge nurse, I want a roster of synthetic patients with
continuity information, so that nurses have context during the outage.

#### Acceptance Criteria

1. WHEN the app loads a patient list THEN the system SHALL return a set of
   synthetic patients with at least an id, display name, and location/room.
2. ALL patient data SHALL be synthetic; no real patient data SHALL be used.

### Requirement 3.2 — Continuity packets seeded to storage **[MVP]**

**User Story:** As a developer, I want synthetic continuity packets seeded before
the demo, so that each patient has baseline continuity context.

#### Acceptance Criteria

1. WHEN the environment is seeded THEN the system SHALL load synthetic continuity
   packets into shared storage, one per demo patient.
2. WHEN a patient is viewed THEN the system SHALL be able to surface that
   patient's continuity context.

### Requirement 3.3 — Patient profile detail view **[Stretch]**

**User Story:** As a nurse, I want a richer per-patient profile (allergies,
baseline status, care team), so that I have fuller context.

#### Acceptance Criteria

1. WHEN viewing a patient THEN the system MAY display extended synthetic profile
   fields sourced from the continuity packet.

---

## Capability 4 — Nurse update submission

### Requirement 4.1 — Submit a nurse update **[MVP]**

**User Story:** As a nurse, I want to submit a free-text update about a patient,
so that continuity information is captured during the outage.

#### Acceptance Criteria

1. WHEN a nurse submits an update THEN the system SHALL require a patient
   identifier and non-empty free-text content.
2. WHEN a valid update is submitted THEN the system SHALL persist it with the
   author role, author name, patient id, timestamp, and the raw text.
3. IF required fields are missing THEN the system SHALL reject the submission with
   a validation error and SHALL NOT persist a partial record.

### Requirement 4.2 — Updates stored immutably and never overwritten **[MVP]**

**User Story:** As a charge nurse, I want original nurse updates kept verbatim and
never altered by the system, so that the clinical record of what a nurse wrote is
always trustworthy.

#### Acceptance Criteria

1. WHEN an update is persisted THEN its raw text SHALL be stored as an immutable
   record.
2. The system SHALL NEVER overwrite, edit in place, or replace the raw update text
   with AI-generated content.
3. WHEN AI processing produces extractions, summaries, or recommendations THEN
   that output SHALL be stored as separate records that reference the original
   update by id, leaving the original intact.
4. WHEN an update is displayed THEN the original text SHALL remain available and
   visually distinguishable from any AI-generated content.

### Requirement 4.3 — Shared, retrievable updates **[MVP]**

**User Story:** As a charge nurse, I want all nurse updates in one shared place,
so that I have a single source of truth during the outage.

#### Acceptance Criteria

1. WHEN any nurse submits an update THEN the system SHALL store it in a shared
   datastore accessible to all roles.
2. WHEN updates for a patient are requested THEN the system SHALL return them in
   chronological order.

### Requirement 4.4 — Edit or retract an update **[Stretch]**

**User Story:** As a nurse, I want to append a correction to an update, so that
mistakes can be addressed without losing history.

#### Acceptance Criteria

1. WHEN a nurse corrects an update THEN the system SHALL store the correction as a
   new linked record and SHALL preserve the original (no in-place edit).

---

## Capability 5 — Bedrock update processing

### Requirement 5.1 — Extract structured information **[MVP]**

**User Story:** As a charge nurse, I want the AI to read nurse updates and pull
out risks, unresolved tasks, deadlines, and follow-up actions, so that nothing is
missed during the outage.

#### Acceptance Criteria

1. WHEN an update is submitted (or on demand) THEN the system SHALL send the raw
   update text to Amazon Bedrock via the Converse API for structured extraction.
2. WHEN extraction completes THEN the system SHALL produce a structured result
   containing risks, unresolved tasks, deadlines, and follow-up actions, with a
   short description and severity/urgency where applicable.
3. WHEN extraction completes THEN the result SHALL be persisted as a separate
   record linked to the originating update and patient, never replacing the raw
   update (see 4.2).

### Requirement 5.2 — Safety guardrails on AI output **[MVP]**

**User Story:** As a charge nurse, I want the AI constrained to observations and
tasks, so that it never makes clinical decisions.

#### Acceptance Criteria

1. WHEN the system prompts Bedrock THEN the prompt SHALL instruct the model never
   to diagnose, prescribe, or change medication orders.
2. WHEN the model surfaces something that implies a clinical decision THEN it
   SHALL be recorded as a task for a human to review, not as a directive.
3. ALL AI output SHALL be framed as recommendations, not final decisions.

### Requirement 5.3 — Generate prioritized summary **[MVP]**

**User Story:** As a charge nurse, I want a prioritized summary across patients
and a per-patient handoff summary, so that I can act on the most important issues
first.

#### Acceptance Criteria

1. WHEN a summary is requested THEN the system SHALL use Bedrock to produce a
   prioritized summary of open risks and unresolved tasks across patients, each
   item having a priority rank and a short rationale.
2. WHEN a per-patient handoff summary is requested THEN the system SHALL generate
   a concise handoff summary for that patient from stored updates and extractions.
3. Generated summaries SHALL be stored separately and SHALL NOT alter source
   updates.

### Requirement 5.4 — Structured, validated model output **[MVP]**

**User Story:** As a developer, I want Bedrock output parsed and validated, so
that malformed responses do not corrupt the app.

#### Acceptance Criteria

1. WHEN Bedrock returns a result THEN the system SHALL parse it against the
   expected schema and reject/flag malformed output rather than persisting it.

### Requirement 5.5 — Automatic processing on submit **[Stretch]**

**User Story:** As a charge nurse, I want updates analyzed automatically on
submission, so that the dashboard is current without a manual step.

#### Acceptance Criteria

1. WHEN an update is submitted THEN the system MAY trigger extraction
   automatically; if automatic processing fails, on-demand processing (5.1) SHALL
   remain available.

---

## Capability 6 — Charge nurse prioritization dashboard

### Requirement 6.1 — Highlight the highest-priority issue **[MVP]**

**User Story:** As a charge nurse, I want the dashboard to highlight the single
highest-priority issue, so that I know what needs attention first.

#### Acceptance Criteria

1. WHEN the charge nurse opens the dashboard THEN the system SHALL display the
   highest-priority open issue prominently.
2. WHEN the top issue is displayed THEN it SHALL show its rationale and related
   patient.

### Requirement 6.2 — Ranked issue list **[MVP]**

**User Story:** As a charge nurse, I want a ranked list of open issues, so that I
can work through them in order.

#### Acceptance Criteria

1. WHEN multiple issues exist THEN the system SHALL display a ranked list below
   the top issue.
2. WHEN an issue is resolved or assigned THEN the dashboard SHALL reflect the
   updated state on refresh.

### Requirement 6.3 — Filtering and grouping **[Stretch]**

**User Story:** As a charge nurse, I want to filter issues by patient or severity,
so that I can focus the view.

#### Acceptance Criteria

1. WHEN filters are applied THEN the dashboard MAY narrow the issue list
   accordingly.

---

## Capability 7 — Human approval workflow

### Requirement 7.1 — Recommendations require human action **[MVP]**

**User Story:** As a charge nurse, I want each AI recommendation presented as a
pending item I must act on, so that a human always authorizes consequential
actions.

#### Acceptance Criteria

1. WHEN the AI proposes an assignment, escalation, or patient-status change THEN
   the system SHALL present it as a pending recommendation requiring action.
2. The system SHALL NEVER apply a recommendation automatically without explicit
   human approval.

### Requirement 7.2 — Approve, reject, or modify **[MVP]**

**User Story:** As a charge nurse, I want to approve, reject, or modify each
recommendation, so that I control what happens.

#### Acceptance Criteria

1. WHEN the charge nurse approves a recommendation THEN the system SHALL apply the
   corresponding action (e.g., create an assignment) and mark it approved.
2. WHEN the charge nurse rejects a recommendation THEN the system SHALL mark it
   rejected and SHALL NOT apply any action.
3. WHEN the charge nurse modifies a recommendation THEN the system SHALL persist
   the modified content and apply the modified version upon approval.
4. Only a `Charge Nurse` role SHALL be able to approve, reject, or modify
   recommendations.

### Requirement 7.3 — Decision confirmation and rationale **[Stretch]**

**User Story:** As a charge nurse, I want to add a note when I reject or modify a
recommendation, so that my reasoning is recorded.

#### Acceptance Criteria

1. WHEN a decision is made THEN the system MAY capture an optional free-text
   rationale stored with the audit entry.

---

## Capability 8 — Task assignment and status tracking

### Requirement 8.1 — Create a task on approval **[MVP]**

**User Story:** As a charge nurse, I want an approved recommendation to create a
task assignment, so that work is clearly owned.

#### Acceptance Criteria

1. WHEN a recommendation is approved THEN the system SHALL create a task with an
   assignee, patient, description, priority, and status `open`.
2. WHEN a task is created THEN it SHALL reference the recommendation it came from.

### Requirement 8.2 — View and track tasks **[MVP]**

**User Story:** As a nurse and charge nurse, I want to see tasks and their status,
so that I know what is outstanding.

#### Acceptance Criteria

1. WHEN tasks are requested THEN the system SHALL return them with their current
   status, visible to the assigned nurse and the charge nurse.
2. WHEN a task status changes (e.g., to `in-progress` or `done`) THEN the system
   SHALL persist the new status with a timestamp.

### Requirement 8.3 — Reassignment and due dates **[Stretch]**

**User Story:** As a charge nurse, I want to reassign tasks and set due times, so
that workload can be balanced.

#### Acceptance Criteria

1. WHEN a task is reassigned or given a due time THEN the system MAY update it and
   record the change.

---

## Capability 9 — Policy assistant with citations

### Requirement 9.1 — Answer policy questions with citations **[MVP]**

**User Story:** As a nurse or charge nurse, I want to ask about facility outage
policies and get an answer with a supporting citation, so that I can act in line
with policy.

#### Acceptance Criteria

1. WHEN a user asks a policy question THEN the system SHALL use an Amazon Bedrock
   Knowledge Base backed by policy documents in Amazon S3 to answer.
2. WHEN an answer is returned THEN the system SHALL include at least one citation
   referencing the source policy document.
3. The policy answer SHALL be informational and SHALL NOT constitute a clinical
   directive.

### Requirement 9.2 — Honest "no answer" behavior **[MVP]**

**User Story:** As a user, I want the assistant to admit when it has no supporting
policy, so that I am not misled.

#### Acceptance Criteria

1. IF the knowledge base has no relevant content THEN the system SHALL state that
   no supporting policy was found and SHALL NOT fabricate an answer or citation.

### Requirement 9.3 — Citation deep-linking **[Stretch]**

**User Story:** As a user, I want to open the cited source passage, so that I can
read it in context.

#### Acceptance Criteria

1. WHEN a citation is shown THEN the system MAY link to the source document and
   highlight the relevant passage.

---

## Capability 10 — Audit history

### Requirement 10.1 — Log recommendations and decisions **[MVP]**

**User Story:** As a charge nurse, I want an audit history of AI recommendations
and human decisions, so that every consequential action is traceable.

#### Acceptance Criteria

1. WHEN an AI recommendation is generated THEN the system SHALL record an audit
   entry with timestamp, source, and content.
2. WHEN a human approves, rejects, or modifies a recommendation THEN the system
   SHALL record an audit entry capturing the actor role, actor name, decision,
   and, for modifications, before/after content.
3. WHEN a task is created THEN the system SHALL record an audit entry.

### Requirement 10.2 — View audit history **[MVP]**

**User Story:** As a charge nurse, I want to view the audit history, so that I can
review what happened during the outage.

#### Acceptance Criteria

1. WHEN the audit history is requested THEN the system SHALL return entries in
   reverse chronological order.

### Requirement 10.3 — Export audit history **[Stretch]**

**User Story:** As a charge nurse, I want to export the audit trail, so that it
can be reviewed after the incident.

#### Acceptance Criteria

1. WHEN an export is requested THEN the system MAY produce a downloadable audit
   record.

---

## Capability 11 — Error handling and Bedrock fallback

### Requirement 11.1 — No data loss on AI failure **[MVP]**

**User Story:** As a nurse, I want my update saved even if the AI is unavailable,
so that continuity information is never lost.

#### Acceptance Criteria

1. WHEN a Bedrock call fails THEN the system SHALL retain the raw update and all
   prior records intact (consistent with 4.2) and SHALL NOT lose data.
2. WHEN extraction or summary fails THEN the failure SHALL NOT alter or delete the
   original update or existing AI records.

### Requirement 11.2 — Clear error surfacing and retry **[MVP]**

**User Story:** As a user, I want clear feedback when AI processing fails, so that
I can retry or continue manually.

#### Acceptance Criteria

1. WHEN a Bedrock or Knowledge Base call fails THEN the system SHALL return a
   clear, safe error message and SHALL offer a retry affordance.
2. WHEN the AI is unavailable THEN the core flow (submit update, view updates,
   manual task creation on approval) SHALL remain usable.

### Requirement 11.3 — Validation and authorization errors **[MVP]**

**User Story:** As a user, I want invalid or unauthorized requests rejected
cleanly, so that the system stays consistent.

#### Acceptance Criteria

1. WHEN a request fails validation THEN the system SHALL return a validation error
   and SHALL NOT persist a partial record.
2. WHEN a role lacks permission for an action THEN the system SHALL return an
   authorization error and SHALL NOT perform the action.

### Requirement 11.4 — Graceful degraded/fallback mode **[Stretch]**

**User Story:** As a charge nurse, I want a degraded mode when Bedrock is down, so
that prioritization can still proceed manually.

#### Acceptance Criteria

1. WHEN Bedrock is unavailable THEN the system MAY present raw updates and allow
   the charge nurse to manually flag priority and create tasks without AI output.
2. WHEN a model is unavailable THEN the system MAY fall back to an alternate
   Bedrock model id without changing the stored data.

---

## MVP vs. Stretch summary

**MVP (required for the end-to-end demo):** 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1,
4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 7.1, 7.2, 8.1, 8.2, 9.1, 9.2, 10.1, 10.2,
11.1, 11.2, 11.3.

**Stretch (only if the MVP is solid):** 1.3, 2.3, 3.3, 4.4, 5.5, 6.3, 7.3, 8.3,
9.3, 10.3, 11.4.
