# CareBridge Functional and Nonfunctional Requirements

AI-driven continuity of care during a hospital EHR outage

## Purpose and Scope

CareBridge is a crisis coordination application for nurses during an electronic health record or hospital software outage. It preserves essential patient continuity information, collects live nurse updates, and uses Amazon Bedrock to help the charge nurse prioritize unresolved care tasks. CareBridge is a decision-support and coordination tool; it does not diagnose patients, prescribe treatment, or independently make clinical decisions.

### Operating Assumption

The hospital has power and basic internet connectivity, but the primary EHR, medication-record system, staffing system, or internal messaging system is unavailable. CareBridge is hosted separately in AWS and acts as a temporary coordination layer until normal systems are restored.

### Personas

| Persona | Primary responsibility |
| --- | --- |
| Nurse | Submit patient updates, review assigned tasks, and report task completion or delays. |
| Charge nurse | Review the overall incident, prioritize patient needs, assign tasks, and approve AI recommendations. |
| System administrator | Configure users, synthetic patient data, facility policies, and incident settings. |

## MVP Priorities

The 18-hour MVP should prioritize the following capabilities:

- Nurse update submission
- Charge nurse dashboard
- Shared patient and task database
- Bedrock-powered extraction, summarization, and prioritization
- Human approval workflow
- Policy question answering with citations

Offline synchronization, advanced notifications, file uploads, and HealthLake integration are stretch features.

## Functional Requirements

### User Access and Roles

- **FR-1.** The system shall allow users to sign in securely.
- **FR-2.** The system shall support role-based access for nurses and charge nurses.
- **FR-3.** The system shall display functionality based on the user’s role.
- **FR-4.** The system shall allow users to sign out.

### Incident Management

- **FR-5.** The charge nurse shall be able to create or activate a crisis incident.
- **FR-6.** An incident shall include a crisis type, such as an EHR outage, medication-system outage, staffing disruption, or hospital communication outage.
- **FR-7.** The system shall display the current incident status and duration.
- **FR-8.** The charge nurse shall be able to deactivate an incident after normal services are restored.

### Patient Continuity Information

- **FR-9.** The system shall store a limited patient continuity profile containing a patient identifier, allergies, critical medications, relevant conditions, care priorities, risk indicators, and assigned nurse.
- **FR-10.** The system shall allow authorized users to view patient continuity information.
- **FR-11.** The system shall identify when patient information has not been recently verified.
- **FR-12.** The system shall maintain an audit trail of changes to patient information.

### Nurse Updates

- **FR-13.** Nurses shall be able to submit updates using a structured form or natural-language text.
- **FR-14.** Nurse updates shall support patient condition, symptoms or concerns, medication status, completed tasks, missed or delayed tasks, supply needs, staffing availability, and additional notes.
- **FR-15.** The system shall associate each update with the submitting nurse, patient, and timestamp.
- **FR-16.** Nurses shall be able to mark updates as urgent.
- **FR-17.** Nurses shall be able to edit or correct their own updates.

### Bedrock AI Processing

- **FR-18.** The system shall use Amazon Bedrock to extract structured information from nurse updates.
- **FR-19.** Bedrock shall identify potential risks, unresolved tasks, deadlines, and required follow-up actions.
- **FR-20.** Bedrock shall generate a concise patient handoff summary using the patient continuity profile and recent nurse updates.
- **FR-21.** The system shall recommend task priorities based on available patient information.
- **FR-22.** The system shall provide the supporting updates or policies used to generate each recommendation.
- **FR-23.** The system shall clearly label AI-generated content.
- **FR-24.** The system shall instruct users to verify AI-generated recommendations before acting.
- **FR-25.** The system shall not allow Bedrock to independently diagnose, prescribe treatment, change medication, or reassign a patient without human approval.

### Policy and Procedure Assistant

- **FR-26.** Nurses shall be able to ask questions about emergency facility procedures.
- **FR-27.** The application shall use a Bedrock Knowledge Base containing facility policies and outage procedures.
- **FR-28.** The system shall provide citations or links to the policy documents used in its response.
- **FR-29.** The system shall indicate when no relevant policy or reliable information is found.

### Charge Nurse Dashboard

- **FR-30.** The charge nurse dashboard shall display active patients, risk levels, unresolved tasks, overdue tasks, urgent updates, available nurses, staffing gaps, supply concerns, and unverified information.
- **FR-31.** The charge nurse shall be able to filter and sort information by urgency, patient, nurse, task, or status.
- **FR-32.** The charge nurse shall be able to review AI-generated priorities and summaries.
- **FR-33.** The charge nurse shall be able to approve, reject, or modify AI recommendations.
- **FR-34.** The charge nurse shall be able to assign or reassign tasks to nurses.
- **FR-35.** The charge nurse shall be able to escalate an issue to a supervisor or designated contact.

### Task Management

- **FR-36.** Authorized users shall be able to create tasks.
- **FR-37.** Each task shall include a description, patient, priority, assigned nurse, due time, status, creator, and timestamp.
- **FR-38.** Nurses shall be able to mark assigned tasks as completed, delayed, or unable to complete.
- **FR-39.** The system shall identify overdue and unconfirmed tasks.
- **FR-40.** The system shall update the charge nurse dashboard when task statuses change.

### Audit and Recovery

- **FR-41.** The system shall record important actions, including patient-information changes, nurse updates, AI recommendations, approvals, rejections, assignments, and escalations.
- **FR-42.** The system shall preserve the original nurse update when an AI-generated summary is created.
- **FR-43.** The system shall allow the charge nurse to export or view a final crisis handoff summary.

## Nonfunctional Requirements

### Availability

- **NFR-1.** CareBridge shall remain available during the simulated EHR outage, assuming basic internet connectivity and electricity remain available.
- **NFR-2.** The application shall display a clear error message if Bedrock or another required AWS service is temporarily unavailable.
- **NFR-3.** The system shall not lose a nurse update if AI processing fails; the original update shall still be stored.

### Performance

- **NFR-4.** Standard dashboard pages should load within three seconds under normal demonstration conditions.
- **NFR-5.** Nurse updates should be saved immediately after submission.
- **NFR-6.** AI summaries and recommendations should normally be returned within 10–15 seconds.
- **NFR-7.** The dashboard should refresh or update promptly when new information is submitted.

### Security and Privacy

- **NFR-8.** Users shall only access features and information permitted by their role.
- **NFR-9.** Patient data shall be encrypted in transit and at rest where supported by AWS services.
- **NFR-10.** The system shall use synthetic patient data for the hackathon demonstration.
- **NFR-11.** The application shall not expose patient information in logs, error messages, or public URLs.
- **NFR-12.** Bedrock Guardrails shall be configured to reduce unsafe or inappropriate responses.

### Reliability and Data Integrity

- **NFR-13.** Every update shall include an author and timestamp.
- **NFR-14.** The system shall preserve the original source information used by Bedrock.
- **NFR-15.** AI-generated information shall never overwrite original patient or nurse data.
- **NFR-16.** The system shall make uncertainty visible rather than presenting incomplete information as fact.

### Usability

- **NFR-17.** A nurse shall be able to submit a basic patient update in fewer than 30 seconds.
- **NFR-18.** The charge nurse shall be able to identify the highest-priority issue within 10 seconds of opening the dashboard.
- **NFR-19.** The interface shall use clear urgency indicators, such as priority labels or colors.
- **NFR-20.** The application shall be usable on a desktop computer, tablet, or mobile browser.
- **NFR-21.** The interface shall use plain language and avoid unnecessary clinical or technical jargon.

### Explainability and Human Oversight

- **NFR-22.** Every AI recommendation shall include a concise explanation.
- **NFR-23.** AI recommendations shall identify the patient updates or policies supporting the recommendation.
- **NFR-24.** Human approval shall be required before a recommendation creates an assignment, escalation, or patient-status change.
- **NFR-25.** Users shall be able to reject or correct AI recommendations.

### Maintainability

- **NFR-26.** Facility policies shall be updateable without changing application code.
- **NFR-27.** The application shall separate patient data, crisis updates, tasks, and policy documents.
- **NFR-28.** The system shall use modular AWS components so Bedrock, the database, and the frontend can be tested independently.

## Demonstration Requirements

- **NFR-29.** The demo shall show a simulated EHR outage.
- **NFR-30.** The demo shall show at least two nurses submitting updates.
- **NFR-31.** The demo shall show Bedrock generating a summary or prioritization.
- **NFR-32.** The demo shall show the charge nurse reviewing and approving an AI recommendation.
- **NFR-33.** The demo shall show the AWS architecture and identify where Amazon Bedrock is used.

## Suggested AWS Components

| Capability | Suggested AWS service | MVP role |
| --- | --- | --- |
| Web application | Amazon S3 or AWS Amplify | Host the nurse and charge nurse interfaces. |
| Backend API | Amazon API Gateway and AWS Lambda | Process requests and coordinate application logic. |
| Application data | Amazon DynamoDB | Store patients, updates, tasks, assignments, and incident status. |
| Documents | Amazon S3 | Store synthetic continuity packets and facility policies. |
| Generative AI | Amazon Bedrock Converse API | Extract information, summarize updates, and recommend priorities. |
| Policy retrieval | Amazon Bedrock Knowledge Bases | Retrieve relevant facility procedures and provide citations. |
| Authentication | Amazon Cognito | Support user login and role-based access. |
| Notifications | Amazon SNS | Optional supervisor or escalation notifications. |

## Out of Scope for the MVP

- Operating during a complete power and internet outage
- Diagnosing patients or recommending medical treatment
- Changing medication orders or clinical records automatically
- Replacing the hospital EHR permanently
- Using real patient data during the hackathon
- Full integration with hospital systems or HealthLake
- Autonomous task assignment without charge-nurse approval

## MVP Acceptance Criteria

The MVP is ready for the hackathon demo when the team can complete this scenario from beginning to end:

- [ ] Activate a simulated EHR outage.
- [ ] Sign in as two nurses and submit updates for different patients.
- [ ] Show the updates stored in the shared system.
- [ ] Use Bedrock to extract risks and generate a prioritized summary.
- [ ] Open the charge nurse dashboard and identify the highest-priority issue.
- [ ] Review the AI recommendation and approve or modify it.
- [ ] Show the resulting task assignment and audit history.
- [ ] Ask the policy assistant a question and show the retrieved supporting policy.
