/**
 * Synthetic demo dataset for the backend (DynamoDB).
 *
 * Mirrors the frontend fixture so a live-deployed demo shows the same scenario.
 * All identifiers are obviously synthetic (P-1001, Nurse-A, CN-1, U-1001, …) and
 * all patient data is fabricated.
 *
 * Contents: 4 patients, 2 nurses + 1 charge nurse, 1 active EHR outage,
 * 6 nurse updates (1 urgent), 1 missed (overdue) task, 1 staffing gap, and
 * several completed and unresolved tasks.
 */

const now = Date.now();
const iso = (offsetMin: number): string => new Date(now + offsetMin * 60_000).toISOString();

export interface DemoPatient {
  patientId: string;
  name: string;
  room: string;
  verified: boolean;
  continuity: string;
}

export interface DemoNurse {
  nurseId: string;
  name: string;
  role: 'nurse' | 'charge-nurse';
  available: boolean;
  activePatients: number;
}

export interface DemoUpdate {
  updateId: string;
  patientId: string;
  authorRole: 'nurse';
  authorName: string;
  text: string;
  createdAt: string;
  urgent?: boolean;
}

export interface DemoTask {
  taskId: string;
  patientId: string;
  assignee: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in-progress' | 'done';
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
}

export interface DemoStaffingGap {
  area: string;
  needed: number;
  available: number;
}

export interface DemoOutage {
  status: 'active';
  startedAt: string;
  actor: string;
  incidentType: string;
  affectedSystems: string[];
  note: string;
}

export interface DemoDataset {
  outage: DemoOutage;
  patients: DemoPatient[];
  nurses: DemoNurse[];
  updates: DemoUpdate[];
  tasks: DemoTask[];
  staffingGaps: DemoStaffingGap[];
}

export function buildDemoDataset(): DemoDataset {
  const patients: DemoPatient[] = [
    { patientId: 'P-1001', name: 'DEMO Patient P-1001', room: '4A-11', verified: true, continuity: 'Stable post-observation; low acuity.' },
    { patientId: 'P-1002', name: 'DEMO Patient P-1002', room: '4A-14', verified: false, continuity: 'On scheduled antibiotics; allergy list unverified.' },
    { patientId: 'P-1003', name: 'DEMO Patient P-1003', room: '4B-02', verified: true, continuity: 'PRN analgesia; monitor pain.' },
    { patientId: 'P-1004', name: 'DEMO Patient P-1004', room: '4B-07', verified: false, continuity: 'Post-op; hourly neuro checks.' },
  ];

  const nurses: DemoNurse[] = [
    { nurseId: 'Nurse-A', name: 'Nurse-A', role: 'nurse', available: true, activePatients: 4 },
    { nurseId: 'Nurse-B', name: 'Nurse-B', role: 'nurse', available: true, activePatients: 5 },
    { nurseId: 'Charge-Nurse-1', name: 'Charge-Nurse-1', role: 'charge-nurse', available: true, activePatients: 0 },
  ];

  const updates: DemoUpdate[] = [
    { updateId: 'U-1001', patientId: 'P-1002', authorRole: 'nurse', authorName: 'Nurse-A', text: 'URGENT: P-1002 febrile 38.9C, scheduled antibiotic due 13:00 NOT given during outage. SpO2 drifting 93-94%, patient looks unwell.', createdAt: iso(-38), urgent: true },
    { updateId: 'U-1002', patientId: 'P-1001', authorRole: 'nurse', authorName: 'Nurse-A', text: 'P-1001 stable, ambulated in hallway, no complaints. Family at bedside.', createdAt: iso(-30) },
    { updateId: 'U-1003', patientId: 'P-1003', authorRole: 'nurse', authorName: 'Nurse-B', text: 'P-1003 reports 6/10 pain and requests reassessment. Timing of last PRN unknown because eMAR is down.', createdAt: iso(-22) },
    { updateId: 'U-1004', patientId: 'P-1004', authorRole: 'nurse', authorName: 'Nurse-B', text: 'P-1004 post-op neuro checks continuing hourly. Alert and oriented x3, no new deficits.', createdAt: iso(-18) },
    { updateId: 'U-1005', patientId: 'P-1002', authorRole: 'nurse', authorName: 'Nurse-A', text: 'P-1002 continuity note: allergy list could not be verified against EHR; please confirm before any new orders.', createdAt: iso(-12) },
    { updateId: 'U-1006', patientId: 'P-1001', authorRole: 'nurse', authorName: 'Nurse-A', text: 'P-1001 tolerating diet, vitals within normal limits at last manual check.', createdAt: iso(-6) },
  ];

  const tasks: DemoTask[] = [
    { taskId: 'T-2001', patientId: 'P-1001', assignee: 'Nurse-A', description: 'Manual vitals recorded on downtime form for P-1001.', priority: 'low', status: 'done', createdAt: iso(-120), updatedAt: iso(-100) },
    { taskId: 'T-2002', patientId: 'P-1004', assignee: 'Nurse-B', description: 'Confirm hourly neuro-check schedule with Charge-Nurse-1.', priority: 'medium', status: 'done', createdAt: iso(-110), updatedAt: iso(-95) },
    { taskId: 'T-2003', patientId: 'P-1003', assignee: 'Nurse-B', description: 'Reassess P-1003 pain and document score on downtime form.', priority: 'medium', status: 'in-progress', createdAt: iso(-40), updatedAt: iso(-20) },
    { taskId: 'T-2004', patientId: 'P-1002', assignee: 'Nurse-A', description: 'Verify P-1002 allergy list against last known records before new orders.', priority: 'medium', status: 'open', createdAt: iso(-11), updatedAt: iso(-11), dueAt: iso(60) },
    // Missed task: past due and still open.
    { taskId: 'T-2005', patientId: 'P-1004', assignee: 'Nurse-B', description: 'MISSED: 15:00 hourly neuro check for P-1004 not completed during outage.', priority: 'high', status: 'open', createdAt: iso(-150), updatedAt: iso(-150), dueAt: iso(-25) },
  ];

  const staffingGaps: DemoStaffingGap[] = [{ area: 'Unit 4B', needed: 3, available: 2 }];

  const outage: DemoOutage = {
    status: 'active',
    startedAt: iso(-55),
    actor: 'Charge-Nurse-1',
    incidentType: 'EHR outage',
    affectedSystems: ['EHR', 'eMAR', 'Secure messaging'],
    note: 'Vendor maintenance overrun (synthetic demo incident).',
  };

  return { outage, patients, nurses, updates, tasks, staffingGaps };
}
