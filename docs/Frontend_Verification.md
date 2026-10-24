# CareBridge visual prototype verification

Verified locally on October 23, 2026 with Node 22.16.0, npm 10.9.2, and the Codex in-app browser. This is a frontend sample, not an operational CareBridge MVP. The charge nurse view is read-only; the nurse view adds session-only interactive state.

## Charge nurse view — checks performed

| Check | Observed result |
| --- | --- |
| `npm install` | Dependencies installed; lockfile generated. |
| `npm run build` | Production bundle generated successfully. |
| `npm run dev` | Vite started on loopback port 5173; HTTP request returned 200. |
| Search for `Patricia` | Patient table showed one matching record, Patricia Lee. |
| Open Patricia's details | Displayed assigned nurse, verification timestamp, stale-data explanation, and associated task. |
| Open original nurse update | Displayed UPD-103 with original text, author, patient, and timestamp. |
| Open an AI sample | Displayed reasoning and a supporting source link; Approve, Modify, and Reject were disabled. |
| Filter tasks to Overdue | Displayed the two initially overdue tasks with Delayed and Unconfirmed statuses. |
| Open policy assistant | Displayed no connected source and no reliable answer; question submission disabled. |
| Desktop layout | Inspected at a 1280-pixel viewport: sidebar, four overview cards, patient table, and adjacent update feed. |
| Mobile layout | Inspected in a 390-pixel iframe: two-column overview cards, collapsed navigation, and wrapping task rows. Opened navigation and switched to Tasks. |
| Tablet layout | Inspected in a 768-pixel iframe: sidebar, two-column overview cards, patient table, and vertically stacked supporting sections. |
| Fixture integrity | Node assertions passed for all patient/nurse/source links, recommendation source links, and required task metadata. |
| Initial dashboard indicators | Assertions confirmed two high-priority patients, three unverified profiles, two overdue tasks, and two available nurses. |
| Freshness boundary | Exactly 60 minutes is current; more than 60 minutes or no timestamp is unverified. |

The temporary responsive preview harness was removed after checking. Mobile and tablet checks exercised CSS layout in browser iframes, not physical devices or touch hardware. Small screens scroll the patient table horizontally within its panel.

## Nurse view — checks performed

Verified after adding the nurse view. The view is scoped to one fictional nurse (Sarah Chen, `n1`). Build and dev-server checks cover the whole app, including this view. Logic and fixture checks were run as one-off Node assertions against `src/data.js`; the assertion harness was removed after checking.

| Check | Observed result |
| --- | --- |
| `npm run build` after nurse view | Production bundle generated successfully with no errors (1566 modules transformed). |
| `npm run dev` hot reload | Vite reloaded each nurse-view edit on loopback without errors. |
| Patient/task scope | Assertions confirmed the view shows only `n1`'s records: 2 patients and 2 tasks, with no other nurse's patients or tasks leaking in. |
| Initial nurse indicators | Assertions confirmed 2 patients, 2 tasks, 1 overdue task, and 1 high-priority patient for `n1`; the attention banner condition is met. |
| Continuity profile (FR-9) | Assertions confirmed every patient has allergies, critical medications, relevant conditions, care priorities, and a risk-indicator list of the expected types. |
| Task metadata (FR-37) | Assertions confirmed each task carries description, patient, priority, assigned nurse, due time, status, creator, and timestamp, and links to a real patient. |
| Update categories (FR-13/14) | Assertions confirmed multiple categories including a supply request. |
| Freshness boundary (FR-11) | Assertions confirmed exactly 60 minutes is current; more than 60 minutes or no timestamp is unverified. |
| Update links | Assertions confirmed the nurse's updates link to real patients and that elapsed-minute math is non-negative. |

Interactive behavior exercised by reproduce steps below (session state only, resets on reload): task status changes to completed, delayed, or unable to complete, with inline confirmation and undo; submitting a nurse update with an urgent flag; and correcting a submitted update while keeping prior versions as history.

## Reproduce the nurse view checks

1. Run `npm run dev` and open the printed local URL. Use the top-bar toggle to switch from **Charge nurse** to **Nurse**.
2. On **My shift**, confirm the attention banner reports 1 overdue task and 1 high-priority patient, and that its buttons jump to My tasks / My patients.
3. Open **My patients**, open a patient, and confirm the continuity profile (allergies, medications, conditions, care priorities, risk indicators), the patient's recent updates, and the open tasks for that patient.
4. Open **My tasks**. Mark a task complete, then report another as delayed and a third as unable to complete; confirm the inline confirmation and the undo on each changed card.
5. Open **Submit update**, choose a patient, add text, set the urgent flag, and submit; confirm the recorded update shows your name and timestamp with the original text. Then choose **Correct this update**, change the text, save, and confirm the prior version appears under correction history.
6. Resize to mobile and tablet widths; confirm the continuity-profile grid stacks to one column and the navigation collapses behind the menu button.

## Reproduce the main visual checks

1. Run `npm install` and `npm run dev`, then open the printed local URL.
2. Search for `Patricia`. Open her details and follow **View original nurse update**.
3. Close the dialog and open **Tasks**. Select **Overdue** in the status filter.
4. Open **AI review**, select the room 401 example, and inspect the explanation, source link, and disabled decisions.
5. Open **Policy assistant** and confirm that no answer or fabricated citation appears.
6. Resize the browser to mobile and tablet widths. On mobile, use the menu button to navigate to Tasks; swipe or scroll within the patient table to access all columns.

## Limits

- No automated application test suite was added for this visual prototype. Fixture and nurse-view logic checks were executed as one-off Node assertions; the charge nurse UI checks were browser-driven, and the nurse-view interactive steps are the reproduce steps above rather than a recorded automated run.
- Authentication, backend role enforcement, shared persistence, audited decisions, assignment mutations, and retry/idempotency behavior do not exist here. The nurse view's update writes, corrections, and task status changes are held in browser session state only and reset on reload; they are not persisted, audited, or sent to the charge nurse view, and the role toggle is not authorization. Disabled decision controls are not a substitute for backend approval enforcement (NFR-24).
- AI content is authored fixture data. Bedrock, Guardrails, Knowledge Base retrieval, and live AWS behavior have not been implemented or verified.
- The AI failure example demonstrates presentation only; it does not test a real failed request or durable update save.
- Build success and local HTTP readiness do not establish NFR-4's dashboard load target. No controlled end-to-end load measurement, clinical usability timing, or production performance result is claimed. AI latency and persistence targets cannot be measured with this sample.
- The handoff is a read-only view. Exporting it or closing the incident is not implemented.
- No deployment, production readiness, or full requirements acceptance is claimed.
