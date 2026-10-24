# Technical Design — CareBridge MVP

## Overview

CareBridge is a thin, reliable, demoable continuity-of-care app for a simulated
EHR outage. A React + Vite + TypeScript SPA calls an API Gateway (HTTP API)
backend of AWS Lambda functions. Application data lives in a single DynamoDB
table. Synthetic policy documents live in Amazon S3 and are retrieved through an
Amazon Bedrock Knowledge Base. The Amazon Bedrock Converse API does the AI work
(extraction, prioritization, summaries).

Two principles shape every decision:

1. **Human-in-the-loop.** AI output is always a *recommendation*. Nothing that
   creates an assignment, escalation, or patient-status change happens without an
   explicit charge-nurse approval, and every such step is written to an audit
   trail.
2. **Original updates are immutable.** Raw nurse update text is stored once and
   never overwritten. All AI output is stored as *separate* records that
   reference the update by id. Structured JSON from Bedrock is validated before
   persistence so the frontend can render it reliably.

All patient data is synthetic.

### Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| Frontend | React + Vite + TypeScript | Fast dev loop, required by brief |
| Edge | API Gateway HTTP API | Cheapest/simplest proxy, CORS built in |
| Compute | AWS Lambda (Node 20, TS via esbuild) | Minimal ops, pay-per-use |
| Data | DynamoDB single table (on-demand) | Smallest viable persistence |
| Files | S3 (policy docs + continuity packets) | KB source + seed storage |
| AI (extract/prioritize/summarize) | Bedrock Converse API | Structured JSON, required |
| AI (policy Q&A) | Bedrock Knowledge Base + RetrieveAndGenerate | Built-in citations |
| IaC | AWS SAM | Fastest path for an 18h MVP, `sam sync` |
| Auth | Demo role selector (Cognito = stretch) | Protects the deadline |

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                     React + Vite SPA                         │
│  Role selector · Outage banner · Update form · Dashboard ·   │
│  Recommendation review · Task board · Audit · Policy Q&A     │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS, typed fetch client
                │ headers: X-Demo-Role, X-Demo-User
        ┌───────▼────────┐
        │  API Gateway    │  HTTP API (CORS)
        └───────┬────────┘
                │ Lambda proxy integration (per route group)
   ┌────────────┼──────────────────────────────────────────────┐
┌──▼────┐ ┌─────▼────┐ ┌────────┐ ┌──────────┐ ┌───────┐ ┌──────▼─┐
│outage │ │updates   │ │process │ │recommend │ │tasks  │ │policy  │
│handler│ │handler   │ │handler │ │handler   │ │handler│ │handler │
└──┬────┘ └─────┬────┘ └───┬────┘ └────┬─────┘ └──┬────┘ └───┬────┘
   │            │          │           │          │          │
   │       ┌────▼──────────▼───────────▼──────────▼────┐ ┌───▼─────────┐
   │       │         DynamoDB (single table)             │ │   Bedrock   │
   └───────►  OUTAGE · PATIENT · UPDATE · EXTRACTION ·    │ │ Converse +  │
           │  REC · TASK · AUDIT                          │ │ KB RetrAndGen│
           └─────────────────────────────────────────────┘ └───┬─────────┘
                     ┌──────────────────────────────────────────▼──┐
                     │ S3: policy docs (KB source) + continuity     │
                     │     packets (synthetic)                       │
                     └───────────────────────────────────────────────┘
```

### Core demo request flow

1. Charge nurse activates outage → `POST /outage` sets state `active`.
2. Role selected in SPA, attached to each request via headers.
3. Nurse submits update → `POST /updates` persists the **immutable** raw update.
4. `POST /updates/{id}/process` → Converse extracts risks/tasks/deadlines/
   follow-ups → persisted as a separate `EXTRACTION`, and pending
   `RECOMMENDATION` records are created for actionable items.
5. `GET /issues` → prioritized list for the dashboard (persisted ranking +
   optional on-demand summary).
6. Charge nurse approves/rejects/modifies → `POST /recommendations/{id}/decision`.
7. On approve → a `TASK` is created; an `AUDIT` entry is written at each step.
8. `GET /audit` → reverse-chronological history.
9. `POST /policy/ask` → KB RetrieveAndGenerate returns answer + citations.

## DynamoDB single-table design

Table `CareBridge`, keys `PK` (partition) and `SK` (sort), plus one GSI `GSI1`
(`GSI1PK`, `GSI1SK`). On-demand billing. IDs are ULIDs so time-ordered SKs sort
chronologically. Timestamps are ISO-8601 UTC.

| Entity | PK | SK | GSI1PK | GSI1SK | Key attributes |
|---|---|---|---|---|---|
| Outage state | `OUTAGE` | `STATE` | — | — | `status` (normal\|active\|resolved), `startedAt`, `endedAt`, `actor` |
| Patient | `PATIENT#{patientId}` | `META` | `PATIENT` | `{name}` | `name`, `room`, `packetKey` |
| Update (immutable) | `PATIENT#{patientId}` | `UPDATE#{ulid}` | — | — | `updateId`, `authorRole`, `authorName`, `text`, `createdAt` |
| Extraction | `PATIENT#{patientId}` | `EXTRACTION#{ulid}` | — | — | `updateId`, `risks[]`, `unresolvedTasks[]`, `followUps[]`, `model`, `createdAt` |
| Recommendation | `REC#{recId}` | `META` | `REC_STATUS#{status}` | `{priorityRank}#{ulid}` | `type`, `patientId`, `updateId`, `content`, `priority`, `rationale`, `status` (pending\|approved\|rejected), `modifiedContent?` |
| Task | `TASK#{taskId}` | `META` | `TASK_STATUS#{status}` | `{ulid}` | `patientId`, `assignee`, `description`, `priority`, `status` (open\|in-progress\|done), `recId`, `createdAt`, `updatedAt` |
| Audit entry | `AUDIT` | `ENTRY#{ulid}` | — | — | `actorRole`, `actorName`, `action`, `targetId`, `before?`, `after?`, `createdAt` |

### Access patterns

- Updates/extractions for a patient → `Query PK = PATIENT#{id}`, `SK begins_with UPDATE#` / `EXTRACTION#` (chronological).
- Pending recommendations, ranked → `Query GSI1 where GSI1PK = REC_STATUS#pending` ordered by `GSI1SK` (priorityRank-prefixed).
- Open tasks → `Query GSI1 where GSI1PK = TASK_STATUS#open`.
- Audit history (reverse chronological) → `Query PK = AUDIT`, `ScanIndexForward = false`.
- Patient roster → `Query GSI1 where GSI1PK = PATIENT`.

Why single-table: one table keeps IaC and IAM minimal, supports every access
pattern above with one GSI, and is more than enough for demo-scale data.

## API design

HTTP API, JSON bodies. Demo identity via headers `X-Demo-Role`
(`nurse`\|`charge-nurse`) and `X-Demo-User`. Handlers enforce role on
consequential routes. Standard error envelope: `{ "error": string, "details"?:
object }`.

| # | Method & path | Operation | Role |
|---|---|---|---|
| 1 | `POST /outage` | Activate/deactivate incident | charge-nurse |
|   | `GET /outage` | Read current state | any |
| 2 | `GET /patients` | List patients | any |
| 3 | `POST /updates` | Submit a nurse update | nurse/charge |
|   | `GET /updates?patientId=` | List updates for a patient | any |
| 4 | `POST /updates/{id}/process` | Process update with Bedrock | nurse/charge |
| 5 | `GET /issues` | List prioritized issues | any |
| 6 | `POST /recommendations/{id}/decision` | Approve/reject/modify | charge-nurse |
|   | `GET /recommendations?status=` | List recommendations | any |
| 7 | `POST /tasks` | Create a task | charge-nurse |
|   | `PATCH /tasks/{id}` | Update task (status/fields) | nurse/charge |
|   | `GET /tasks` | List tasks | any |
| 8 | `POST /tasks/{id}/assign` | Assign or reassign a task | charge-nurse |
| 9 | `GET /audit` | Retrieve audit history | any |
| 10 | `POST /policy/ask` | Ask the policy assistant | any |

HTTP status conventions: `200` success, `201` create, `400` validation, `403`
role/authorization, `404` not found, `409` illegal state transition, `502`
Bedrock/KB upstream failure.

## Request and response schemas

Types are TypeScript-shaped (shared in `backend/src/lib/types.ts`). `?` = optional.

### 1. Outage

```ts
// POST /outage
interface OutageActionRequest { action: "activate" | "deactivate";
  incidentType?: string; affectedSystems?: string[]; note?: string }
interface OutageState { status: "normal" | "active" | "resolved";
  startedAt?: string; endedAt?: string; actor?: string;
  incidentType?: string; affectedSystems?: string[]; note?: string }
// GET /outage -> OutageState ; POST /outage -> OutageState
```

### 2. Patients

```ts
interface Patient { patientId: string; name: string; room: string;
  packetKey?: string }           // GET /patients -> { patients: Patient[] }
```

### 3. Updates

```ts
// POST /updates
interface SubmitUpdateRequest { patientId: string; text: string }   // text non-empty
interface NurseUpdate {          // immutable once created
  updateId: string; patientId: string; authorRole: "nurse" | "charge-nurse";
  authorName: string; text: string; createdAt: string }
// POST /updates -> NurseUpdate (201)
// GET /updates?patientId= -> { updates: NurseUpdate[] }  (chronological)
```

### 4. Process update (Bedrock)

```ts
// POST /updates/{id}/process  (body optional)
interface Extraction {
  extractionId: string; updateId: string; patientId: string;
  risks: { description: string; severity: "low" | "medium" | "high" }[];
  unresolvedTasks: { description: string; urgency: "low" | "medium" | "high";
    deadline: string | null }[];
  followUps: { description: string }[];
  model: string; createdAt: string;
}
interface ProcessResponse {
  extraction: Extraction;
  recommendations: Recommendation[];   // newly created pending recs
  // The original NurseUpdate is NOT returned modified; it is untouched.
}
```

### 5. Issues (prioritized)

```ts
interface Issue {
  issueId: string;            // = recId or extraction-derived id
  patientId: string; patientName: string;
  title: string; rationale: string;
  priority: "low" | "medium" | "high"; rank: number;   // 1 = highest
  source: "extraction" | "recommendation";
  status: "open" | "assigned" | "resolved";
}
// GET /issues -> { topIssue: Issue | null; issues: Issue[] }  (rank ascending)
```

### 6. Recommendation decision

```ts
type RecType = "assignment" | "escalation" | "status-change";
interface Recommendation {
  recId: string; type: RecType; patientId: string; updateId: string;
  content: { description: string; suggestedAssignee?: string };
  priority: "low" | "medium" | "high"; priorityRank: number; rationale: string;
  status: "pending" | "approved" | "rejected";
  modifiedContent?: Recommendation["content"]; createdAt: string;
}
// POST /recommendations/{id}/decision
interface DecisionRequest {
  decision: "approve" | "reject" | "modify-approve";
  content?: Recommendation["content"];   // required for modify-approve
  note?: string;                         // optional rationale (stretch)
}
interface DecisionResponse { recommendation: Recommendation; task?: Task }
// approve/modify-approve -> task present; reject -> no task
```

### 7–8. Tasks

```ts
interface Task {
  taskId: string; patientId: string; assignee: string; description: string;
  priority: "low" | "medium" | "high"; status: "open" | "in-progress" | "done";
  recId?: string; createdAt: string; updatedAt: string;
}
// POST /tasks  { patientId, assignee, description, priority }     -> Task (201)
// PATCH /tasks/{id}  { status?, description?, priority? }         -> Task
// POST /tasks/{id}/assign  { assignee }                           -> Task
// GET /tasks  -> { tasks: Task[] }
```

### 9. Audit

```ts
interface AuditEntry {
  entryId: string; actorRole: string; actorName: string;
  action: "outage-activated" | "outage-deactivated" | "recommendation-generated"
    | "recommendation-approved" | "recommendation-rejected"
    | "recommendation-modified" | "task-created" | "task-updated"
    | "task-assigned";
  targetId?: string; before?: unknown; after?: unknown; createdAt: string;
}
// GET /audit -> { entries: AuditEntry[] }  (reverse chronological)
```

### 10. Policy assistant

```ts
// POST /policy/ask
interface PolicyAskRequest { question: string }
interface Citation { title: string; s3Uri: string; snippet: string }
interface PolicyAnswer {
  answer: string; citations: Citation[];
  hasSupport: boolean;   // false -> "no supporting policy found"
}
```

## Bedrock input and output JSON formats

### Converse — extraction (operation 4)

Model id from `BEDROCK_MODEL_ID`. Low temperature. System prompt carries the
guardrail; the user turn carries the raw update text. We request strict JSON.

System prompt (constant):
> You extract continuity-of-care information from nurse notes during an EHR
> outage. You never diagnose, never prescribe, never change medication orders,
> and never make clinical decisions. Return ONLY a JSON object matching the
> schema. If a note implies a clinical decision, record it as an unresolved task
> for a human to review. Do not include prose outside the JSON.

Converse request (shape):
```json
{
  "modelId": "<BEDROCK_MODEL_ID>",
  "system": [{ "text": "<guardrail system prompt>" }],
  "messages": [{ "role": "user", "content": [{ "text":
    "Extract to this JSON schema: {risks,unresolvedTasks,followUps}. Note:\n<RAW UPDATE TEXT>" }]}],
  "inferenceConfig": { "temperature": 0.1, "maxTokens": 1024 }
}
```

Expected model output (parsed from the assistant text, then schema-validated):
```json
{
  "risks": [{ "description": "SpO2 trending down overnight", "severity": "high" }],
  "unresolvedTasks": [{ "description": "Recheck vitals in 1h", "urgency": "high",
    "deadline": "2026-10-23T14:00:00Z" }],
  "followUps": [{ "description": "Confirm family contact number" }]
}
```

Validation: parse JSON; coerce/validate against the `Extraction` sub-schema
(severity/urgency enums, deadline ISO or null). On parse failure → treat as
Bedrock failure (see error handling), persist nothing derived, keep the raw
update untouched.

### Converse — prioritization / summary (operation 5)

Input is the set of open extractions (with patient ids). Same guardrail system
prompt. Requested output:
```json
{
  "topIssue": { "patientId": "P-002", "title": "Rising fever, antibiotic due",
    "priority": "high", "rank": 1, "rationale": "High-urgency task past due" },
  "issues": [ { "patientId": "P-002", "title": "...", "priority": "high",
    "rank": 1, "rationale": "..." }, { "...": "..." } ]
}
```
These are advisory rankings; they never auto-create tasks. Each actionable item
is also materialized as a pending `Recommendation`.

### Knowledge Base — policy Q&A (operation 10)

Uses `RetrieveAndGenerate` against `KB_ID`. The API returns generated text plus
`citations[].retrievedReferences[]`. We map each reference to
`{ title, s3Uri, snippet }`. If `citations` is empty or retrieval returns nothing
relevant, respond with `hasSupport: false` and a message that no supporting
policy was found — never fabricate.

## Error handling when Bedrock is unavailable

Failure types: throttling, timeout, model/KB unavailable, malformed output.

Rules:
1. **No data loss.** A Bedrock failure never alters or deletes the raw update or
   any existing records. Processing is a read-of-update + write-of-new-records
   operation; if the AI step fails, no derived records are written.
2. **One retry with backoff** inside the Lambda for transient errors
   (throttling/timeout). If it still fails → return `502` with a safe message
   `{ "error": "AI processing is temporarily unavailable. Your update is saved." }`.
3. **Malformed JSON** from the model is treated as a failure (same `502`); we do
   not persist partial/garbled extractions.
4. **Model fallback (stretch).** If `BEDROCK_FALLBACK_MODEL_ID` is set and the
   primary model is unavailable, retry once with the fallback before returning
   `502`.
5. **Degraded core flow.** Submitting updates, listing updates, manual task
   creation, assignment, and audit all work with Bedrock down. The dashboard
   shows raw updates and lets the charge nurse flag priority and create tasks
   manually (stretch 11.4).
6. **Frontend.** Shows the saved update, a non-blocking error, and a Retry button
   that re-calls `POST /updates/{id}/process`.

## Human approval boundaries

- Operations that **mutate assignments/escalations/patient status** (`POST
  /recommendations/{id}/decision`, `POST /tasks`, `POST /tasks/{id}/assign`,
  outage activate/deactivate) require `X-Demo-Role: charge-nurse`; otherwise
  `403`.
- AI **never** writes a Task directly. The only path to a Task from AI output is:
  `Recommendation (pending)` → charge-nurse `approve`/`modify-approve` → Task.
  `reject` creates no Task.
- Every consequential mutation writes an `AUDIT` entry in the same logical
  operation (recommendation generated, decision taken with before/after on
  modify, task created/assigned).
- Nurses may create updates and update task status on tasks assigned to them, but
  cannot approve recommendations or manage the outage.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `TABLE_NAME` | all handlers | DynamoDB table name |
| `BUCKET_NAME` | policy/seed | S3 bucket for policy docs + packets |
| `AWS_REGION` | all | Region (provided by Lambda runtime) |
| `BEDROCK_MODEL_ID` | process/issues | Converse model id (e.g. a Claude model) |
| `BEDROCK_FALLBACK_MODEL_ID` | process/issues | Optional fallback model (stretch) |
| `KB_ID` | policy | Bedrock Knowledge Base id |
| `KB_MODEL_ARN` | policy | Model ARN used by RetrieveAndGenerate |
| `CORS_ORIGIN` | all | Allowed SPA origin |
| `LOG_LEVEL` | all | Logging verbosity |
| `VITE_API_BASE_URL` | frontend | API Gateway base URL |

## IAM permissions (least privilege)

Per-function execution roles, scoped to the specific table/bucket/model ARNs:

- **All handlers:** `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `Query` on the
  `CareBridge` table and its `GSI1` index ARN only; CloudWatch Logs
  (`logs:CreateLogGroup/Stream`, `PutLogEvents`).
- **process + issues handlers:** `bedrock:Converse` (and
  `bedrock:InvokeModel`) on the specific model ARN(s) in `BEDROCK_MODEL_ID`
  (and fallback if set).
- **policy handler:** `bedrock:RetrieveAndGenerate` and `bedrock:Retrieve` on the
  Knowledge Base ARN (`KB_ID`), plus `bedrock:InvokeModel` on `KB_MODEL_ARN`.
- **policy/seed access to S3:** `s3:GetObject` (and `s3:ListBucket`) on
  `BUCKET_NAME` only; the seed script additionally needs `s3:PutObject`.
- **S3 bucket:** Block Public Access on; no public policy. KB service role granted
  read on the bucket for ingestion.

No wildcard resource ARNs on Bedrock or S3. No `dynamodb:Scan` or
`DeleteItem` granted (the app never scans or hard-deletes).

## Local development strategy

- **Monorepo** with npm workspaces: `frontend`, `backend`, `infra`, `scripts`.
  Shared types in `backend/src/lib/types.ts`, imported by the frontend client.
- **Frontend:** `vite dev` with `VITE_API_BASE_URL` pointing at either a deployed
  API or a local API. A mock mode (fixture JSON matching the schemas above) lets
  UI work proceed even when AWS is unavailable.
- **Backend:** `sam local start-api` runs handlers behind a local HTTP API.
  DynamoDB via `dynamodb-local` (Docker) with `TABLE_NAME` pointed at it; create
  the table from the SAM definition on startup.
- **Bedrock locally:** Bedrock/KB are not emulated. Two options: (a) call real
  Bedrock using developer AWS credentials with the configured model/KB, or (b)
  set `BEDROCK_MOCK=1` to return canned structured JSON (matching the Extraction/
  PolicyAnswer schemas) so the full UI flow is exercisable offline. The mock path
  is for development only and is clearly labeled.
- **Build:** esbuild bundles each Lambda (Node 20, ESM). `tsc --noEmit` and
  ESLint for type/lint checks.
- **Tests:** unit tests for handlers (validation, role enforcement, DynamoDB key
  mapping, Bedrock-response parsing with the client mocked) run with no cloud
  dependency.

## AWS deployment strategy

- **IaC:** AWS SAM (`infra/template.yaml`): HTTP API with CORS; one Lambda per
  route group (outage, updates, process, issues, recommendations, tasks, policy)
  or a few grouped handlers; the `CareBridge` DynamoDB table + `GSI1` (on-demand);
  the S3 bucket (Block Public Access). Function env vars and least-privilege IAM
  as above. Parameters: `BedrockModelId`, `FallbackModelId`, `KbId`, `KbModelArn`,
  `CorsOrigin`.
- **Bedrock Knowledge Base:** creating a KB cleanly needs a vector store. For the
  18h MVP the KB (and its OpenSearch Serverless / vector store) is provisioned via
  a documented one-time CLI/console step, and its id + model ARN are passed to the
  stack as parameters. Full KB-as-IaC (custom resource) is a stretch.
- **Build & deploy:** `sam build` (esbuild) then `sam deploy --guided` once to
  capture parameters in `samconfig.toml`; `sam sync --watch` for fast iteration
  during the hack.
- **Seeding:** `scripts/seed.ts` uploads synthetic policy docs + continuity
  packets to S3, triggers KB ingestion, and writes synthetic patients + a few
  sample updates to DynamoDB. Idempotent so it can be re-run before the demo.
- **Frontend hosting:** `vite build` to static assets served from S3 (optionally
  CloudFront) or run locally pointed at the deployed API — whichever is lower risk
  on the day. CORS restricted to the SPA origin.
- **Regions/models:** `BedrockModelId`, `KbId`, and `KbModelArn` are parameters
  because model and Knowledge Base availability vary by region; the stack is
  deployed in a region where the chosen Converse model and KB are enabled.

## Safety and data-integrity mapping

- No diagnosis/prescription/med-order/autonomous decision → guardrail system
  prompts (operation 4/5), all AI output framed as recommendations, human
  approval required before any action (Req 5.2, 7.1, 7.2).
- Original updates never overwritten → `NurseUpdate` is write-once; extractions,
  summaries, and recommendations are separate records keyed by `updateId`; the
  process operation never updates the update item (Req 4.2, 11.1).
- Structured, reliable UI data → Bedrock output is JSON, schema-validated before
  persistence; malformed output is rejected, not shown (Req 5.4).
- Auditability → every recommendation and decision and task action writes an
  `AUDIT` entry (Req 10.1).
- Synthetic data only → seed data and roster are synthetic (Req 3.1, 3.2).

## Testing strategy

- Handler unit tests: validation, role enforcement (`403` paths), single-table
  key/Query construction, and Bedrock/KB response parsing with the AWS SDK
  clients mocked — prioritizing the safety-critical approval and parsing paths.
- A thin integration smoke test exercising the core demo path against
  `sam local` (or a deployed stack) with `BEDROCK_MOCK=1`.
- Manual rehearsal of the end-to-end demo scenario before presenting.
- Tests are added alongside feature implementation; they are not the MVP focus but
  cover role enforcement, the never-overwrite guarantee, and JSON validation.
```
