# Deferred / out-of-scope features

To keep the MVP small and reliable, CareBridge ships only the core end-to-end
path:

1. Outage activation
2. Nurse update submission
3. Bedrock prioritization (AI analysis + pending recommendations)
4. Charge nurse approval (approve / reject / modify)
5. Task assignment (created only on approval)
6. Audit history

Everything below is intentionally **deferred**. Where code already exists it is
retained in the repo but not wired into the demo path, so nothing is lost and it
can be re-enabled later.

## Deferred

- **Policy assistant (Bedrock Knowledge Base Q&A).** Backend handler
  (`backend/src/handlers/policy.ts`), service (`backend/src/lib/policy.ts`), the
  frontend component (`frontend/src/components/PolicyAssistant.tsx`), and the
  synthetic policy docs under `data/policies/` all remain. The component is **not
  mounted** in `App.tsx`, and the Knowledge Base provisioning is not required for
  the core demo. Re-enable by importing and rendering `PolicyAssistant` and
  provisioning the KB (see `docs/DEPLOYMENT.md`).
- **Cognito authentication.** The demo role selector stands in; real auth is out
  of scope.
- **Per-patient richer profiles, notifications, file uploads, offline sync,
  HealthLake, real medical-device integration.** Not implemented.

## Retained secondary dashboard panels

The staffing roster / staffing-gap panel and the headline metric tiles remain on
the dashboard. They are lightweight, read-only summaries that support the core
charge-nurse workflow and add no subsystem or external dependency, so they stay.

## Invariants preserved regardless of scope

- Amazon Bedrock may only **recommend**; it never creates an assignment. A task
  is created solely by an explicit charge-nurse approval
  (`backend/src/handlers/recommendations.ts`), never by the processing path
  (`backend/src/handlers/process.ts`).
- The original nurse update is stored once and immutably (`UPDATE#` record,
  written via `putItemIfAbsent`). AI output is a **separate** record (`ANALYSIS#`)
  linked by `updateId`. Both are shown in the UI — the verbatim original and the
  AI handoff summary, clearly labeled and visually distinct.
- AI failures never lose data: the update is preserved, an error is recorded, and
  no task is created.
