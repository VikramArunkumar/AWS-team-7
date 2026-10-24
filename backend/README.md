# CareBridge Backend

Serverless backend for CareBridge: AWS SAM (API Gateway + Lambda) over a single
Amazon DynamoDB table. Node.js 22, ES modules. **Synthetic patient data only.**

This scaffold implements persistence, the nurse-update flow, the AI recommendation
approval workflow, task management, and the charge nurse dashboard read. The
Bedrock call is stubbed behind an interface and not yet wired to live AWS.

## Single-table design

One table, `CareBridge-<stage>`. Every record is scoped to an incident and lives
under the partition key `INCIDENT#<id>`. The sort-key prefix is the entity type,
which keeps patients, updates, tasks, AI recommendations, and audit history
logically separate within one table (NFR-27).

| PK | SK | Entity |
| --- | --- | --- |
| `INCIDENT#<id>` | `META` | Incident metadata (FR-5–FR-8) |
| `INCIDENT#<id>` | `PATIENT#<patientId>` | Patient continuity profile (FR-9–FR-12) |
| `INCIDENT#<id>` | `UPDATE#<updateId>` | Nurse update, original source (FR-13–FR-17) |
| `INCIDENT#<id>` | `TASK#<taskId>` | Task (FR-36–FR-40) |
| `INCIDENT#<id>` | `REC#<recId>` | AI recommendation: proposed / approved / rejected |
| `INCIDENT#<id>` | `AUDIT#<isoTs>#<uuid>` | Append-only audit event (FR-41) |
| `USER#<userId>` | `PROFILE` | User profile and role |

`GSI1` (`GSI1PK`, `GSI1SK`) answers nurse-scoped lookups such as "tasks assigned
to a nurse" (`INCIDENT#<id>#NURSE#<nurseId>` / `TASK#<taskId>`).

## Key design rules (from the requirements)

- **Persist before AI (NFR-3, FR-42).** Creating an update (`POST .../updates`)
  saves it and returns `201` with no Bedrock call. Processing is a separate step
  (`POST .../updates/{id}/process`). If Bedrock fails, the update is marked
  `failed` and remains fully intact.
- **AI never overwrites source data (NFR-15).** Recommendations are separate
  `REC` items that cite their source update IDs. They are labeled `aiGenerated`.
- **Human approval is enforced in the backend (NFR-24).** A recommendation only
  becomes a task through `POST .../recommendations/{id}/approve`, which runs a
  single `TransactWriteItems`: flip the recommendation to `approved` (only if
  still `proposed`), create the task, and write the audit event together. The
  status condition makes a double-approve a no-op, so retries never duplicate a
  task. Rejection applies nothing.
- **Role enforcement (NFR-8).** Identity is read from `X-User-Id` / `X-User-Role`
  headers in `lib/http.js` — the single place to swap in a Cognito authorizer
  later. Role checks are the real control; hiding UI is not authorization.
- **Audit everything important (FR-41).** `lib/audit.js` writes append-only
  events with actor, action, target, and a small non-sensitive summary. Patient
  free-text and raw bodies stay out of logs and audit detail (NFR-11).

## API

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/incidents` | charge nurse | Activate an incident (FR-5) |
| GET | `/incidents/{id}` | any | Incident status + duration (FR-7) |
| POST | `/incidents/{id}/deactivate` | charge nurse | Close an incident (FR-8) |
| GET | `/incidents/{id}/dashboard` | any | Dashboard snapshot (FR-30, FR-31) |
| POST | `/incidents/{id}/updates` | nurse | Submit an update (FR-13–FR-16) |
| PATCH | `/incidents/{id}/updates/{id}` | author | Correct own update (FR-17) |
| POST | `/incidents/{id}/updates/{id}/process` | any | Run Bedrock (FR-18–FR-23) |
| POST | `/incidents/{id}/recommendations/{id}/approve` | charge nurse | Approve → task (FR-33, NFR-24) |
| POST | `/incidents/{id}/recommendations/{id}/reject` | charge nurse | Reject (NFR-25) |
| POST | `/incidents/{id}/tasks` | charge nurse | Create a task (FR-36) |
| PATCH | `/incidents/{id}/tasks/{id}` | nurse/charge | Status or reassignment (FR-38, FR-34) |

Send identity headers on every request, e.g. `X-User-Id: n1`,
`X-User-Role: nurse` (or `charge_nurse`).

## Project layout

```
backend/
  template.yaml              # SAM: table + GSI1, functions, API, IAM
  env.local.json             # sam local env vars (placeholders only)
  package.json               # dev scripts (local DynamoDB, seed)
  src/
    package.json             # runtime deps bundled by SAM (CodeUri: src/)
    lib/
      keys.js                # single-table key schema
      ddb.js                 # Document client (honors DYNAMODB_ENDPOINT)
      http.js                # responses, auth headers, role checks
      ids.js                 # IDs + timestamps
      audit.js               # append-only audit helper
      bedrock.js             # Bedrock behind an interface (stub for now)
    handlers/
      incidents.js dashboard.js updates.js recommendations.js tasks.js
  scripts/
    create-local-table.js    # create the table in DynamoDB Local
    seed.js                  # load ../../src/data.js fixtures into the table
```

## Run locally

Requires Docker, the AWS SAM CLI, and Node 22+.

```bash
cd backend
npm install                 # dev/seed scripts
npm install --prefix src    # Lambda runtime deps

npm run ddb:up              # DynamoDB Local on :8000 (Docker)
npm run ddb:create-table    # create CareBridge-dev
npm run seed                # load the synthetic fixtures from src/data.js

npm run local:api           # sam build + sam local start-api
```

Then, e.g.:

```bash
curl http://127.0.0.1:3000/incidents/INC-0042/dashboard \
  -H 'X-User-Id: charge1' -H 'X-User-Role: charge_nurse'
```

Stop DynamoDB Local with `npm run ddb:down`.

> `sam local` reaches host DynamoDB Local via `host.docker.internal`, set in
> `env.local.json`. The seed and table scripts talk to `127.0.0.1:8000` directly.

## Not yet implemented

- Live Bedrock Converse call, Guardrails, and output validation (`lib/bedrock.js`
  returns a labeled synthetic recommendation; set `BEDROCK_MODE=live` once built).
- Bedrock Knowledge Base policy assistant (FR-26–FR-29).
- Cognito authorizer (headers stand in for authenticated identity today).
- Patient-profile write endpoints and the final crisis handoff export (FR-43).
- Automated tests.

Deploy (`sam build && sam deploy --guided`) is untested here; validate region,
Bedrock model, IAM least privilege, and Guardrails before any live run.
