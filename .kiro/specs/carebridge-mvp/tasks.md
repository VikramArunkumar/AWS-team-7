# Implementation Plan — CareBridge MVP (18-hour hackathon)

Tasks are grouped into 8 phases and tagged **[Must have]**, **[Should have]**, or
**[Stretch]**. The **Must-have path is scoped to produce a working end-to-end
demo by the end of hour 10**; Should-have and Stretch work fills hours 10–18 and
hardens the demo.

Out of the must-have path entirely (per scope): Cognito, notifications, file
uploads, advanced offline synchronization, HealthLake.

Requirement references use the capability numbering in `requirements.md`. Route
names match `design.md`.

### Time budget

| Phase | Window | Goal |
|---|---|---|
| 1 Project setup | 0:00–1:30 | Repo, IaC skeleton, deploys |
| 2 Backend & DynamoDB | 1:30–4:30 | Data path works end to end |
| 3 Bedrock integration | 4:30–7:00 | Extraction + prioritization |
| 4 React dashboard | 7:00–9:30 | Core UI on real API |
| 5 Approval & audit | 9:30–10:00 | **Hour-10 must-have demo complete** |
| 6 Policy assistant | 10:00–12:30 | Cited policy Q&A |
| 7 Testing & deployment | 12:30–15:30 | Stable deployed stack |
| 8 Demo prep | 15:30–18:00 | Rehearsed, seeded, resilient |

> **Hour-10 milestone (must-have demo):** activate outage → pick two roles →
> submit updates for two patients → stored in DynamoDB → processed by Bedrock →
> risks/tasks extracted → prioritized issue list → top issue on dashboard →
> charge nurse approves a recommendation → task created → audit entry visible.

---

## Phase 1 — Project setup (0:00–1:30)

- [ ] 1.1 Scaffold monorepo (npm workspaces: `frontend`, `backend`, `infra`,
  `scripts`), base `tsconfig`, ESLint/Prettier, folder skeleton. **[Must have]**
  _Req: 12-level IaC/setup_
- [ ] 1.2 Shared domain types in `backend/src/lib/types.ts` (Outage, Patient,
  NurseUpdate, Extraction, Recommendation, Task, AuditEntry, API req/res).
  **[Must have]** _Req: 4.1, 5.1, 7.1, 8.1, 10.1_
- [ ] 1.3 SAM skeleton `infra/template.yaml`: HTTP API + CORS, single DynamoDB
  table + GSI1 (on-demand), S3 bucket (Block Public Access), one placeholder
  Lambda; `samconfig.toml`; esbuild build. Deploy once to confirm. **[Must have]**
- [ ] 1.4 Frontend Vite + React + TS app boots with a typed API client stub and
  `VITE_API_BASE_URL`. **[Must have]** _Req: 1.1_
- [ ] 1.5 `BEDROCK_MOCK` scaffolding + fixture JSON matching schemas, so UI/flow
  work without live Bedrock. **[Should have]** _Req: 11.2_

---

## Phase 2 — Backend and DynamoDB (1:30–4:30)

- [ ] 2.1 DynamoDB access layer `backend/src/lib/dynamo.ts`: client, ULID key
  builders, put/query helpers for the design's access patterns. **[Must have]**
  _Req: 4.3, 10.2_
- [ ] 2.2 Request helper: parse body, read `X-Demo-Role`/`X-Demo-User`, role
  enforcement, standard error envelope + status codes. **[Must have]**
  _Req: 1.2, 11.3_
- [ ] 2.3 Outage endpoints `GET /outage`, `POST /outage` (activate/deactivate,
  charge-nurse only), with audit on state change. **[Must have]**
  _Req: 2.1, 2.2, 1.2_
- [ ] 2.4 Patients: synthetic roster + continuity packet data in `data/`;
  `GET /patients`. **[Must have]** _Req: 3.1, 3.2_
- [ ] 2.5 Updates: `POST /updates` (validate patientId + non-empty text, persist
  immutable raw update) and `GET /updates?patientId=` (chronological). Reject
  partial records. **[Must have]** _Req: 4.1, 4.2, 4.3, 11.3_
- [ ] 2.6 Enforce never-overwrite at the data layer: updates are write-once; no
  code path updates a `UPDATE#` item. **[Must have]** _Req: 4.2, 11.1_
- [ ] 2.7 Incident metadata (type/affected systems/note) on activate. **[Should
  have]** _Req: 2.3_

---

## Phase 3 — Bedrock integration (4:30–7:00)

- [ ] 3.1 Bedrock client `backend/src/lib/bedrock.ts`: Converse helper with the
  guardrail system prompt (no diagnose/prescribe/med-order), low temperature,
  strict JSON parse + schema validation; honors `BEDROCK_MOCK`. **[Must have]**
  _Req: 5.1, 5.2, 5.4_
- [ ] 3.2 Process endpoint `POST /updates/{id}/process`: read raw update, call
  Converse, persist `Extraction` as a separate record linked by `updateId`
  (original untouched), create pending `Recommendation`s for actionable items.
  **[Must have]** _Req: 5.1, 5.2, 5.3, 7.1_
- [ ] 3.3 Prioritization for `GET /issues`: rank open extractions/recommendations
  (model-assisted or rule-based fallback), return `{ topIssue, issues }`.
  **[Must have]** _Req: 5.3, 6.1, 6.2_
- [ ] 3.4 Bedrock failure handling: one retry w/ backoff, `502` safe message, no
  derived writes on failure, raw update preserved. **[Must have]**
  _Req: 11.1, 11.2_
- [ ] 3.5 Per-patient handoff summary generation. **[Should have]** _Req: 5.3_
- [ ] 3.6 Auto-process on submit (fire `process` after `POST /updates`). **[Should
  have]** _Req: 5.5_
- [ ] 3.7 Fallback model via `BEDROCK_FALLBACK_MODEL_ID`. **[Stretch]** _Req:
  11.4_

---

## Phase 4 — React dashboard (7:00–9:30)

- [ ] 4.1 App shell: header with demo role selector (Nurse / Charge Nurse,
  clearly labeled) + outage banner; React context for role/user/outage; API
  client injects `X-Demo-Role`/`X-Demo-User`. **[Must have]** _Req: 1.1, 1.2,
  2.1_
- [ ] 4.2 Nurse view: patient picker, update form with validation, that patient's
  update history (original text clearly marked). **[Must have]** _Req: 4.1, 4.2,
  1.2_
- [ ] 4.3 Charge dashboard: highlighted top issue + ranked issue list from
  `GET /issues`, reflecting state on refresh. **[Must have]** _Req: 6.1, 6.2_
- [ ] 4.4 Recommendation review cards (approve / reject / modify) wired to the
  decision route; visible to charge-nurse only. **[Must have]** _Req: 7.1, 7.2,
  1.2_
- [ ] 4.5 Task board showing tasks + status. **[Must have]** _Req: 8.2_
- [ ] 4.6 Loading/error states + Retry on failed processing. **[Should have]**
  _Req: 11.2_
- [ ] 4.7 Issue filtering/grouping by patient/severity. **[Stretch]** _Req: 6.3_

---

## Phase 5 — Human approval and audit trail (9:30–10:00)

- [ ] 5.1 Decision endpoint `POST /recommendations/{id}/decision`
  (approve/reject/modify-approve), charge-nurse only; never auto-applies.
  **[Must have]** _Req: 7.1, 7.2_
- [ ] 5.2 Task creation on approval: `POST /tasks` path from approved rec with
  assignee/patient/description/priority/status `open`, linked by `recId`.
  **[Must have]** _Req: 8.1_
- [ ] 5.3 Audit writes on every consequential action (rec generated, decision with
  before/after on modify, task created); `GET /audit` reverse-chronological.
  **[Must have]** _Req: 10.1, 10.2_
- [ ] 5.4 Audit log panel in the dashboard. **[Must have]** _Req: 10.2_
- [ ] 5.5 `PATCH /tasks/{id}` status transitions + `POST /tasks/{id}/assign`
  reassignment, with audit. **[Should have]** _Req: 8.2, 8.3_
- [ ] 5.6 Optional decision rationale note stored with the audit entry. **[Should
  have]** _Req: 7.3_

> ✅ **End of hour 10: must-have end-to-end demo is complete and demoable.**

---

## Phase 6 — Policy assistant (10:00–12:30)

- [ ] 6.1 Author synthetic outage policy documents in `data/policies/`. **[Must
  have]** _Req: 9.1_
- [ ] 6.2 Provision Bedrock Knowledge Base over the S3 policy prefix (documented
  CLI/console step); capture `KB_ID` + `KB_MODEL_ARN` as stack params. **[Must
  have]** _Req: 9.1_
- [ ] 6.3 `POST /policy/ask` via RetrieveAndGenerate: return `{ answer, citations,
  hasSupport }`; honest no-answer when no citations. **[Must have]** _Req: 9.1,
  9.2_
- [ ] 6.4 Policy Q&A UI panel with question box, answer, citation chips. **[Must
  have]** _Req: 9.1, 9.2_
- [ ] 6.5 Citation deep-link to source document/passage. **[Stretch]** _Req: 9.3_
- [ ] 6.6 KB-as-IaC via SAM custom resource. **[Stretch]**

---

## Phase 7 — Testing and deployment (12:30–15:30)

- [ ] 7.1 Handler unit tests for the safety-critical paths: role enforcement
  (`403`), never-overwrite guarantee, Bedrock JSON parse/validation (SDK mocked).
  **[Must have]** _Req: 4.2, 1.2, 5.4, 11.3_
- [ ] 7.2 `scripts/seed.ts`: upload synthetic policies + continuity packets to S3,
  trigger KB ingestion, seed patients + sample updates; idempotent. **[Must
  have]** _Req: 3.2, 12 seed_
- [ ] 7.3 `sam deploy` the full stack; verify all routes reachable; CORS to SPA
  origin. **[Must have]**
- [ ] 7.4 Integration smoke test of the core path against the stack with
  `BEDROCK_MOCK` or live Bedrock. **[Should have]**
- [ ] 7.5 Frontend build + host (S3/CloudFront) or run locally against deployed
  API. **[Should have]**
- [ ] 7.6 Tighten least-privilege IAM to specific table/bucket/model/KB ARNs.
  **[Should have]**

---

## Phase 8 — Demo preparation (15:30–18:00)

- [ ] 8.1 Seed a realistic synthetic scenario: 3–4 patients, several updates, at
  least one clearly highest-priority issue. **[Must have]**
- [ ] 8.2 Rehearse the 11-step scenario end to end; fix integration gaps. **[Must
  have]**
- [ ] 8.3 README with run/deploy/seed/demo steps and the exact demo script.
  **[Must have]**
- [ ] 8.4 Safety pass: confirm guardrail prompts, role enforcement, no
  auto-applied AI output, originals never overwritten. **[Must have]** _Req: 5.2,
  7.1, 4.2_
- [ ] 8.5 Resilience: pre-seed processed results so the demo survives a Bedrock
  hiccup; verify Retry works. **[Should have]** _Req: 11.2_
- [ ] 8.6 Degraded manual-priority mode if Bedrock is down during the demo.
  **[Stretch]** _Req: 11.4_
- [ ] 8.7 Polish: empty states, copy, light styling. **[Stretch]**

---

## Explicitly out of the must-have path

Cognito sign-in (stretch 1.3), notifications, file uploads, advanced offline
synchronization, HealthLake, real medical-device integration, autonomous
emergency calls, real patient data. None are on the critical demo path.

## Must-have task index (the hour-10 path)

1.1, 1.2, 1.3, 1.4 · 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 · 3.1, 3.2, 3.3, 3.4 · 4.1,
4.2, 4.3, 4.4, 4.5 · 5.1, 5.2, 5.3, 5.4 — completes the end-to-end demo minus
policy Q&A. Policy assistant must-haves (6.1–6.4) and deployment/seed/test
must-haves (7.1–7.3, 8.1–8.4) harden and complete the full scenario by hour 18.
