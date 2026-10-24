# Charge nurse visual prototype verification

Verified locally on October 23, 2026 with Node 22.16.0, npm 10.9.2, and the Codex in-app browser. This is a read-only frontend sample, not an operational CareBridge MVP.

> **Later change:** sign-in now gates this dashboard. It appears only after Cognito sign-in when `GET /me` reports `charge_nurse`, and the dev server now runs at `http://localhost:5173`. The checks below predate that change and describe the dashboard screens themselves. For authentication verification, see the [README](../README.md#verification). The authentication limit listed below no longer applies; backend role enforcement now exists but has not been validated against live AWS.

## Checks performed

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

## Reproduce the main visual checks

1. Run `npm install` and `npm run dev`, then open the printed local URL.
2. Search for `Patricia`. Open her details and follow **View original nurse update**.
3. Close the dialog and open **Tasks**. Select **Overdue** in the status filter.
4. Open **AI review**, select the room 401 example, and inspect the explanation, source link, and disabled decisions.
5. Open **Policy assistant** and confirm that no answer or fabricated citation appears.
6. Resize the browser to mobile and tablet widths. On mobile, use the menu button to navigate to Tasks; swipe or scroll within the patient table to access all columns.

## Limits

- No automated application test suite was added for this visual prototype. Fixture checks were executed as one-off Node assertions; the UI checks above were browser-driven.
- Authentication, backend role enforcement, update writes/corrections, shared persistence, audited decisions, assignment mutations, and retry/idempotency behavior do not exist here. Disabled decision controls are not a substitute for backend approval enforcement (NFR-24).
- AI content is authored fixture data. Bedrock, Guardrails, Knowledge Base retrieval, and live AWS behavior have not been implemented or verified.
- The AI failure example demonstrates presentation only; it does not test a real failed request or durable update save.
- Build success and local HTTP readiness do not establish NFR-4's dashboard load target. No controlled end-to-end load measurement, clinical usability timing, or production performance result is claimed. AI latency and persistence targets cannot be measured with this sample.
- The handoff is a read-only view. Exporting it or closing the incident is not implemented.
- No deployment, production readiness, or full requirements acceptance is claimed.
