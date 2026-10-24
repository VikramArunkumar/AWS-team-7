# CareBridge

AI-driven continuity-of-care system for a simulated hospital EHR outage
(AWS hackathon MVP). CareBridge preserves patient continuity information,
collects nurse updates, uses Amazon Bedrock to surface risks and unresolved
tasks, generates prioritized handoff summaries, and keeps a human in the loop for
every consequential action. Uses synthetic patient data only.

> Full spec: `.kiro/specs/carebridge-mvp/` (requirements, design, tasks).

## Status

Scaffolding only. Implemented so far (must-have tasks 1.1–1.3):

- Monorepo with npm workspaces.
- Shared domain types (`backend/src/lib/types.ts`).
- AWS SAM infrastructure skeleton (HTTP API, DynamoDB single table + GSI1, S3
  bucket, placeholder `/health` Lambda).

Route handlers, the React app, Bedrock integration, and policy Q&A come in later
phases.

## Repository layout

```
.
├── backend/      # Lambda handlers + shared types (TypeScript)
│   ├── src/lib/types.ts      # shared domain + API types
│   ├── src/handlers/         # Lambda handlers (health placeholder for now)
│   └── build.mjs             # esbuild bundler for handlers
├── frontend/     # React + Vite SPA (scaffolded in task 1.4)
├── infra/        # AWS SAM template + config
│   ├── template.yaml
│   └── samconfig.toml
├── scripts/      # seeding / ops scripts (Phase 7)
├── data/         # synthetic policies + continuity packets
└── .kiro/specs/carebridge-mvp/   # requirements, design, tasks
```

## Prerequisites

- Node.js >= 20 (tested on Node 24)
- npm >= 10
- For deploying/running the backend on AWS: AWS CLI and AWS SAM CLI, plus AWS
  credentials with access to DynamoDB, S3, and Amazon Bedrock. (Not required for
  the current scaffolding tasks.)

## Install

```bash
npm install
```

## Run locally

At this stage there is no running app yet — the frontend (task 1.4) and route
handlers (Phase 2+) are not implemented. What you can do now:

```bash
# Type-check and lint the whole workspace
npm run typecheck
npm run lint

# Run backend unit tests (no AWS needed)
npm test
```

Once the SAM CLI is installed, you can validate and build the infrastructure:

```bash
# Validate the SAM template
npm run validate --workspace @carebridge/infra

# Build handlers and run the API locally (requires Docker)
sam build -t infra/template.yaml
sam local start-api -t infra/template.yaml
# -> GET http://127.0.0.1:3000/health
```

Copy `.env.example` to `.env` and fill in values before deploying. See
`.kiro/specs/carebridge-mvp/design.md` for the full environment variable list.

## Deploy (later phases)

```bash
npm run deploy:guided --workspace @carebridge/infra   # first time, captures params
npm run sync --workspace @carebridge/infra            # fast iteration
```

## Safety

- No diagnosis, prescription, medication-order changes, or autonomous clinical
  decisions. AI output is advisory and requires explicit charge-nurse approval.
- Original nurse updates are immutable and never overwritten by AI output.
- All patient data is synthetic.
