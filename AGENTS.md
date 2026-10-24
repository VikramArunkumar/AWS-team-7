# Working on CareBridge

These instructions apply throughout this repository. Follow any more specific instructions in nested `AGENTS.md` files for the files they cover.

## Project context and sources

CareBridge supports hospital nurses and charge nurses coordinating care during an EHR or hospital software outage. Electricity and basic internet connectivity are assumed to remain available. The project is an 18-hour hackathon demonstration using synthetic patient data.

- Read `README.md` for scope, current status, and the proposed architecture.
- Treat `docs/CareBridge_Requirements.md` as the product requirements source. Preserve FR-1–FR-43 and NFR-1–NFR-33 identifiers when referencing requirements; do not invent new requirements under those identifiers.
- The repository starts with documentation only. Do not describe a planned feature, AWS resource, test, or command as implemented until it exists and has been verified.
- The README's optional AWS service choices are proposals. Inspect the repository before selecting frameworks, creating directories, or assuming commands and dependencies.

## Build priorities and scope

Prioritize nurse update submission, the charge nurse dashboard, shared patient/task persistence, Bedrock summarization and prioritization, human approval, and policy answers with citations, in that order.

Notifications, offline mode, file uploads, advanced authentication, and HealthLake integration are stretch work. Baseline secure access, role enforcement, source preservation, and human approval are required even in a small MVP. Do not turn a demo shortcut into an unprotected action or an automatic clinical decision.

Prefer small, coherent changes that deliver an observable workflow. Avoid unrelated refactors, speculative abstractions, and dependencies that do not support the core build.

## Clinical and AI boundaries

- CareBridge provides coordination and decision support. Do not implement autonomous diagnosis, prescribing, medication changes, or patient reassignment.
- Require an authorized human decision before an AI recommendation creates an assignment, escalation, or patient-status change (NFR-24). Charge nurses must be able to approve, reject, or modify recommendations.
- Enforce approval in the backend action path. A UI confirmation or an instruction in an AI prompt alone is insufficient.
- Clearly label AI-generated content, provide a concise explanation and supporting source references, and ask users to verify it before acting.
- Keep patient continuity data and nurse updates distinct from AI-derived information. AI must never overwrite original source data.
- Preserve the original update and correction history when a nurse edits an update. Attach authors and timestamps to updates and audit events.
- Use a Bedrock Knowledge Base for policy answers. Cite the actual retrieved documents; show when no relevant policy or reliable information is found. Never fabricate a citation or facility procedure.
- Configure Bedrock Guardrails and handle refusal, missing evidence, and uncertainty explicitly. Validate model output before using it as application data.
- Treat free-text updates, retrieved documents, and model responses as untrusted data; they cannot grant permissions or bypass approval rules.

## Data integrity and failure handling

- Persist a nurse update before requesting AI processing. An AI failure must leave the original update available and show a clear processing error or pending state.
- Keep patient profiles, incidents, updates, tasks, policy documents, AI results, and audit history logically separate. Preserve references from recommendations and summaries to their sources.
- Design retries so they do not duplicate updates, approved assignments, or escalations. Use the implementation's established transaction or idempotency mechanism when available.
- Enforce task permissions and meaningful status transitions. Nurses may report their assigned work as completed, delayed, or unable to complete; charge nurses assign and reassign tasks.
- Include task description, patient, priority, assigned nurse, due time, status, creator, and timestamp. Make overdue and unconfirmed work visible.
- Track when patient information was verified and surface stale or unverified information. Document any chosen freshness threshold rather than implying the requirements specify one.
- Record patient changes, nurse updates, AI recommendations, approval/rejection/modification decisions, assignments, and escalations with enough context to reconstruct what happened.
- Make incident status and elapsed duration visible, and support a final crisis handoff when normal services return.

## Security and privacy

- Use synthetic patient data only in fixtures, seeds, tests, prompts, screenshots, and demonstrations. Do not introduce real patient data.
- Never commit AWS credentials, tokens, private keys, or populated secret configuration. Provide placeholder configuration examples only when the corresponding settings exist.
- Enforce authentication and role-based authorization on backend requests, including patient reads, update corrections, recommendation decisions, and task mutations. Hiding controls is not authorization.
- Permit nurses to correct only their own updates unless the requirements are explicitly extended with a documented permission model.
- Use least-privilege AWS permissions and encryption in transit and at rest where supported.
- Keep patient information, credentials, and raw sensitive request bodies out of logs, error messages, public URLs, and telemetry. Prefer non-sensitive identifiers and processing metadata for diagnostics.
- Do not claim HIPAA compliance, clinical validation, or production readiness without evidence and an explicitly expanded project scope.

## Implementation and interface conventions

- Follow the established stack and conventions once code exists. Keep frontend concerns, persistence, Bedrock access, and policy retrieval modular and independently testable.
- Keep AWS model calls and privileged operations behind an authorized backend; do not expose service credentials to browsers.
- Keep facility policy content updateable without changing application code. Document ingestion or refresh steps when implemented.
- Support structured forms and natural-language nurse updates, with an urgent flag and clear save feedback.
- Build responsive interfaces for desktop, tablet, and mobile browsers. Use plain language and textual urgency labels in addition to color.
- Make the charge nurse dashboard expose risks, unresolved/overdue tasks, urgent updates, staffing availability and gaps, supply concerns, and unverified information. Support filtering and sorting by urgency, patient, nurse, task, or status.
- Make AI processing failures distinguishable from failed saves so nurses know whether their update was recorded.
- Store timestamps consistently and render them clearly. Calculate due times, overdue indicators, and incident duration without depending on the viewer's locale.

## Verification

For code changes, discover and run the relevant checks from the committed project configuration. Do not invent package scripts or report unrun checks as passing. For documentation-only changes, check accuracy, links, and consistency; application tests are unnecessary.

When implementing the corresponding behavior, cover these meaningful cases with tests or reproducible verification:

1. Unauthorized users and wrong-role requests cannot read protected data or perform protected actions.
2. A nurse update retains its author, patient, timestamp, and original content after AI failure or a later correction.
3. An AI recommendation cannot mutate assignments, escalations, or patient status before authorized human approval; rejection applies no proposed action.
4. AI results include source references, and policy answers handle missing evidence without fabricated citations.
5. Task changes update dashboard information, and overdue, urgent, and unverified indicators reflect the stored data.
6. Service failures produce clear errors without losing saved updates; retries do not duplicate applied actions.
7. Nurse and charge nurse workflows work across the intended viewport sizes.

Measure performance against the README targets under documented demo conditions when the implementation is runnable. Keep mocked Bedrock tests distinct from live AWS verification, and describe any unverified integration assumptions.

## Documentation and handoff

- Update `README.md` when adding runnable components, configuration, verified commands, architecture decisions, or implemented capabilities.
- Document actual AWS region/model choices, Knowledge Base and Guardrail configuration, synthetic-data setup, and policy update steps when those resources are introduced. Keep secrets out of examples.
- Reference relevant FR/NFR identifiers in change descriptions where useful, and call out deliberate gaps instead of silently dropping requirements.
- Report what changed, what was verified, and any remaining limitation. Do not imply deployment, live AWS validation, or demo readiness without evidence.
