# CareBridge

CareBridge is a crisis coordination application for hospital nurses during an EHR or hospital software outage. It helps nurses share patient updates and helps charge nurses prioritize work, coordinate tasks, and prepare handoffs with support from Amazon Bedrock.

CareBridge assumes electricity and basic internet connectivity remain available. It provides decision support and coordination; it does not diagnose patients, prescribe treatment, or autonomously make clinical decisions.

## Project status

This repository contains a **local visual prototype** with both a charge nurse view and a nurse view, built with React and Vite, alongside the [CareBridge requirements](docs/CareBridge_Requirements.md). The prototype uses synthetic fixtures and a calm, light interface with teal accents. A top-bar toggle switches between the two role views; this is a demo convenience, not authenticated role enforcement. It is not the operational MVP: backend services, authentication, shared persistence, AWS infrastructure, and live AI integrations are not implemented. The broader features and AWS architecture below remain planned unless explicitly listed here.

The charge nurse view includes:

- An overview with an active incident timer, priority counts, patient table, urgent nurse updates, supply concern, and staffing summary.
- Patient search by name, identifier, room, concern, or nurse; priority and verification filters; nurse filtering; and priority, name, or room sorting.
- Patient details linked to original synthetic nurse updates, plus task details and status filtering and sorting.
- Care team, illustrative AI review, policy-unavailable, and crisis handoff preview screens.
- Responsive navigation and layouts, keyboard-accessible controls, and native modal dialogs.

On the charge nurse view, task assignment, recommendation decisions, and policy questions are intentionally disabled previews. No clinical action, assignment, escalation, message, or incident closure occurs.

The nurse view (scoped to one fictional nurse) includes:

- A shift overview of that nurse's patients, assigned tasks, and recent updates.
- The patients assigned to that nurse, with the same priority and verification-freshness indicators.
- The nurse's tasks, where status can be set to completed, delayed, or unable to complete. These status changes are held in browser session state only and are not persisted or sent anywhere.
- A structured-plus-free-text update form with a category and an urgent flag. A submitted update is recorded in browser session state with the nurse's name and a timestamp, and the original text is shown back unchanged. There is no shared storage, no AI processing, and no delivery to the charge nurse; the two views do not share state.

Both views use fictional demo personas, not authenticated sessions. The nurse update path writes only to in-memory React state that resets on reload; do not connect real patient data to this prototype.

These screens explore FR-7, FR-11, FR-13–FR-16, FR-22–FR-24, FR-29–FR-33, FR-37–FR-39, and FR-43 visually; they do not satisfy the complete backend, authorization, persistence, audit, or AWS requirements. In particular, the role toggle does not implement FR-2/FR-3 role enforcement, and submitted updates are not persisted (FR-15 persistence and FR-17 correction history remain unimplemented).

The project targets an 18-hour hackathon build using **synthetic patient data only**. It is a demonstration, with no claim of production readiness or regulatory certification.

## Users

| Role | Responsibilities |
| --- | --- |
| Nurse | Submit patient updates, review assigned tasks, and record completion, delays, or inability to complete work. |
| Charge nurse | Activate and close incidents, review risks and staffing, approve or correct AI recommendations, assign tasks, escalate concerns, and prepare final handoffs. |
| System administrator | Configure users, facility policies, and synthetic patient data. Detailed administrator permissions remain to be defined. |

Secure sign-in, sign-out, role-specific views, and enforced access permissions are baseline requirements. Advanced authentication is a stretch feature, not a reason to omit baseline access control.

## MVP priorities

Build these capabilities in the order recommended by the requirements:

1. Nurse update submission.
2. Charge nurse dashboard.
3. Shared patient and task database.
4. Bedrock summarization and prioritization.
5. Human approval workflow.
6. Policy question answering with citations.

Notifications, offline mode, file uploads, advanced authentication, and HealthLake integration are stretch features. Keep these outside the core build unless the MVP is complete.

## Expected workflow

1. A charge nurse activates an incident, such as an EHR outage, medication-system outage, staffing disruption, or hospital communication outage. Users can see its status and duration.
2. Nurses review limited patient continuity profiles, including allergies, critical medications, relevant conditions, care priorities, risk indicators, and assigned nurses. Information that has not been recently verified is flagged.
3. At least two nurses submit structured or natural-language updates. Updates capture condition changes, concerns, medication status, completed or delayed tasks, supply needs, staffing availability, and notes. Each update has a patient, author, timestamp, and optional urgent flag.
4. The application stores each original update before requesting AI processing. Nurses can correct their own updates while preserving an audit history.
5. Bedrock extracts structured information, identifies potential risks and follow-up work, generates handoff summaries, and recommends priorities. AI output is labeled, explains its reasoning, links to supporting updates, and tells users to verify it before acting.
6. The charge nurse reviews, approves, rejects, or modifies recommendations. A recommendation requires human approval before it creates an assignment, escalation, or patient-status change.
7. Nurses update task status; the dashboard promptly reflects changes and flags overdue or unconfirmed work. Nurses can also ask policy questions and receive answers grounded in facility documents with citations.
8. After normal services return, the charge nurse views or exports a final crisis handoff summary and deactivates the incident.

## Functional scope

Requirement identifiers below refer to the source requirements document.

| Area | Planned capabilities | Requirements |
| --- | --- | --- |
| Access | Secure sign-in and sign-out, nurse and charge nurse roles, role-specific functionality. | FR-1–FR-4 |
| Incidents | Activate and deactivate incidents; show crisis type, status, and duration. | FR-5–FR-8 |
| Patient continuity | Limited patient profiles, authorized viewing, verification freshness, and change history. | FR-9–FR-12 |
| Nurse updates | Structured and free-text submission, author/patient/time association, urgent flags, and correction of a nurse's own updates. | FR-13–FR-17 |
| Bedrock processing | Structured extraction, risk and deadline identification, handoff summaries, priority recommendations, supporting sources, AI labeling, and human verification. | FR-18–FR-25 |
| Policy assistant | Emergency procedure questions answered through a Bedrock Knowledge Base, with citations and an explicit indication when reliable information is unavailable. | FR-26–FR-29 |
| Charge nurse dashboard | Patients and risk levels, unresolved and overdue tasks, urgent updates, available nurses, staffing gaps, supply concerns, and unverified information; filtering, sorting, recommendation review, task assignment, and escalation. | FR-30–FR-35 |
| Tasks | Authorized creation; description, patient, priority, assigned nurse, due time, status, creator, and timestamp; completion/delay/unable-to-complete reporting; overdue and unconfirmed indicators. | FR-36–FR-40 |
| Audit and recovery | Record patient changes, updates, recommendations, decisions, assignments, and escalations; preserve original updates; view or export final handoffs. | FR-41–FR-43 |

## Proposed AWS architecture

The following is an implementation starting point. Only Amazon Bedrock, a Bedrock Knowledge Base, and Bedrock Guardrails are specified AI components in the requirements; the remaining service choices are proposals to validate during implementation.

```mermaid
flowchart TD
    Users[Nurses and charge nurses] --> Web[Responsive web application]
    Web --> Auth[Amazon Cognito: proposed authentication]
    Web --> API[API Gateway and Lambda: proposed backend]
    API --> Store[(DynamoDB: proposed operational and audit storage)]
    API --> AI[Amazon Bedrock with Guardrails]
    AI --> KB[Bedrock Knowledge Base]
    KB --> Policies[S3: proposed facility policy source]
```

Persist nurse updates before invoking Bedrock. Store AI results separately with references to their source information and review decisions. Persist approved actions through an authorized backend operation; displaying or generating a recommendation must not apply it.

Keep patient profiles, incidents, nurse updates, tasks, AI recommendations, audit records, and policy documents logically separate. Backend authorization must enforce permissions independently of the interface. Facility policies must be updateable without application code changes, and the frontend, database access, and Bedrock integration must be independently testable.

## Safety, security, and reliability

- Use synthetic patient data throughout the hackathon, including fixtures, screenshots, prompts, and demonstrations.
- Encrypt patient data in transit and at rest where supported by AWS services. Keep credentials out of source control, and keep patient information out of logs, error messages, and public URLs.
- Configure Bedrock Guardrails to reduce unsafe responses. Bedrock must not independently diagnose, prescribe treatment, change medication, or reassign patients. Guardrails support, but do not replace, application authorization and human approval.
- Preserve original patient and nurse data. AI output must never overwrite its sources; corrections must retain an audit history.
- Show supporting sources, uncertainty, stale information, and missing policy evidence clearly. Do not present incomplete information as fact.
- If Bedrock or another required AWS service is unavailable, display a clear error. A failed AI request must not discard a saved nurse update.
- Record important actions and their authors and timestamps, including approvals, rejections, task assignments, and escalations.

## Quality targets

These are acceptance targets from the requirements, not measured results.

| Measure | Target |
| --- | --- |
| Standard dashboard page load | Within 3 seconds under normal demo conditions. |
| Nurse update persistence | Immediately after submission; independent of AI success. |
| AI summaries and recommendations | Normally within 10–15 seconds. |
| Dashboard changes | Refresh or update promptly after new information or task changes. |
| Basic nurse update entry | Fewer than 30 seconds. |
| Highest-priority issue identification | Within 10 seconds of opening the charge nurse dashboard. |
| Device support | Desktop, tablet, and mobile browsers. |

Use plain language and clear urgency labels; do not rely on color alone to convey priority. Operational verification freshness thresholds and the exact meaning of prompt dashboard updates still need implementation decisions; the visual prototype uses the documented 60-minute example below.

## Local development

Use Node.js 22.12 or later in the Node 22 line, or a newer supported LTS release, and npm. From the repository root:

```sh
npm install
npm run dev
```

Open the Local URL printed by Vite (normally `http://127.0.0.1:5173`). The development server binds to loopback. Stop it with Ctrl+C.

```sh
npm run build    # Create the production frontend in dist/
npm run preview  # Serve that build locally (normally port 4173)
```

`npm install`, `npm run dev`, and `npm run build` were verified with Node 22.16.0 and npm 10.9.2; the production build was re-verified with Node 22 after the nurse view was added and passed with no errors, and the dev server hot-reloaded the change without errors. `npm run preview` is configured but was not separately exercised. The dependency lockfile is included with the source so subsequent installs can use `npm ci`.

### Frontend structure and demo behavior

- `src/main.jsx`: the charge nurse view (`App`), the nurse view (`NurseView`), a role toggle, search/filter state, and detail dialogs. The charge nurse dialogs are read-only; the nurse view adds session-only task status and update-submission state.
- `src/data.js`: synthetic patients, nurses, updates, tasks, incident, and authored AI examples, plus the demo nurse identity and update categories used by the nurse view. Source updates and recommendations are separate records linked by identifiers.
- `src/styles.css`: light/teal styling and responsive layouts. DM Sans and Manrope load from Google Fonts when reachable, with local sans-serif fallbacks.
- `index.html`: Vite entry point. No credentials or AWS settings are needed.

The seed fixtures are read-only. The sample clock anchors on each page load. Incident duration and overdue/freshness calculations use timestamps, refresh every 30 seconds, and do not depend on the viewer's locale. Displayed times use `America/Los_Angeles` (Pacific time). Information is flagged as unverified if it has no verification timestamp or was last verified more than **60 minutes** ago; this is a prototype choice, not a requirement or facility policy.

The eight displayed patients are a subset of a fictional staffing plan. AI text is authored sample content, not generated by Bedrock. One update demonstrates an AI-failure presentation while retaining its original source text; no actual save or AI request occurs. The policy screen explicitly reports that no policy source is connected and produces no answer or citation. Handoff is a read-only view, not an export or incident closure.

The nurse view adds the only interactive data paths in the prototype, and both write to in-memory React state that resets on reload: task status changes (completed, delayed, unable to complete) and submitted updates. A submitted update keeps the nurse author, patient, timestamp, and original text; it is not persisted to shared storage, processed by AI, or delivered to the charge nurse view. The role toggle swaps the rendered view only and carries no authorization.

### Verification

See [frontend verification notes](docs/Frontend_Verification.md) for browser checks and remaining limits. This visual-only change does not add an application test suite. Backend authorization, persistence, approval enforcement, retries, AWS integrations, and operational performance targets remain unverified and unimplemented.

Before integrating AWS, select a region and a supported Bedrock model, establish least-privilege service permissions, configure Guardrails, and prepare a Knowledge Base with synthetic or demonstration facility policies. Document actual configuration variable names and setup steps alongside the implementation; do not commit secrets.

## Demo acceptance checklist

- [ ] Simulate an EHR outage with an active incident.
- [ ] Show at least two nurses submitting synthetic patient updates.
- [ ] Show the charge nurse dashboard reflecting patients, urgent concerns, and task status.
- [ ] Show Bedrock generating a summary or prioritization with supporting sources.
- [ ] Show a charge nurse reviewing and approving an AI recommendation before its resulting action occurs.
- [ ] Demonstrate task assignment and a nurse recording task progress or completion.
- [ ] Demonstrate policy question answering with citations and a clear no-evidence response.
- [ ] Demonstrate that a failed AI request preserves the original nurse update.
- [ ] View or export the final crisis handoff and close the incident.
- [ ] Present the AWS architecture and identify where Bedrock is used.

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Use the [requirements document](docs/CareBridge_Requirements.md) for detailed acceptance criteria and preserve its FR/NFR identifiers when describing implementation coverage. Update this README as features, architecture decisions, and verified development commands are added.
