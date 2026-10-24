/**
 * Synthetic demo dataset for CareBridge (single source of truth for the demo).
 *
 * All identifiers are obviously synthetic (P-1001, Nurse-A, CN-1, U-1001, …) and
 * all patient data is fabricated. This fixture is built fresh on each call so it
 * doubles as the reset-to-original state before recording the hackathon video.
 *
 * Contents (per demo requirements):
 *   - 4 patients (P-1001 … P-1004)
 *   - 2 nurses (Nurse-A, Nurse-B) + 1 charge nurse (Charge-Nurse-1)
 *   - 1 active EHR outage
 *   - 6 nurse updates (U-1001 … U-1006), including 1 clearly urgent update
 *   - 1 missed task (overdue / status "missed-ish": past due and still open)
 *   - 1 staffing gap
 *   - several completed and unresolved tasks
 */

import type { DashboardData, Nurse, QueueItem, StaffingGap, Task } from '../types.ts';

// Anchor every timestamp to "now" so durations read naturally in the demo.
const now = Date.now();
const iso = (offsetMin: number): string => new Date(now + offsetMin * 60_000).toISOString();

export function buildDemoData(): DashboardData {
  // --- Patients (4) ------------------------------------------------------
  const patients = [
    { patientId: 'P-1001', name: 'DEMO Patient P-1001', room: '4A-11', verified: true },
    { patientId: 'P-1002', name: 'DEMO Patient P-1002', room: '4A-14', verified: false },
    { patientId: 'P-1003', name: 'DEMO Patient P-1003', room: '4B-02', verified: true },
    { patientId: 'P-1004', name: 'DEMO Patient P-1004', room: '4B-07', verified: false },
  ];

  // --- Staff: 2 nurses + 1 charge nurse ---------------------------------
  const nurses: Nurse[] = [
    { nurseId: 'Nurse-A', name: 'Nurse-A', role: 'nurse', available: true, activePatients: 4 },
    { nurseId: 'Nurse-B', name: 'Nurse-B', role: 'nurse', available: true, activePatients: 5 },
    {
      nurseId: 'Charge-Nurse-1',
      name: 'Charge-Nurse-1',
      role: 'charge-nurse',
      available: true,
      activePatients: 0,
    },
  ];

  // --- Nurse updates (6, one clearly urgent) ----------------------------
  const updates = [
    {
      updateId: 'U-1001',
      patientId: 'P-1002',
      authorRole: 'nurse' as const,
      authorName: 'Nurse-A',
      // The urgent update.
      text: 'URGENT: P-1002 febrile 38.9C, scheduled antibiotic due 13:00 NOT given during outage. SpO2 drifting 93-94%, patient looks unwell.',
      createdAt: iso(-38),
      urgent: true,
    },
    {
      updateId: 'U-1002',
      patientId: 'P-1001',
      authorRole: 'nurse' as const,
      authorName: 'Nurse-A',
      text: 'P-1001 stable, ambulated in hallway, no complaints. Family at bedside.',
      createdAt: iso(-30),
    },
    {
      updateId: 'U-1003',
      patientId: 'P-1003',
      authorRole: 'nurse' as const,
      authorName: 'Nurse-B',
      text: 'P-1003 reports 6/10 pain and requests reassessment. Timing of last PRN unknown because eMAR is down.',
      createdAt: iso(-22),
      urgent: false,
    },
    {
      updateId: 'U-1004',
      patientId: 'P-1004',
      authorRole: 'nurse' as const,
      authorName: 'Nurse-B',
      text: 'P-1004 post-op neuro checks continuing hourly. Alert and oriented x3, no new deficits.',
      createdAt: iso(-18),
    },
    {
      updateId: 'U-1005',
      patientId: 'P-1002',
      authorRole: 'nurse' as const,
      authorName: 'Nurse-A',
      text: 'P-1002 continuity note: allergy list could not be verified against EHR; please confirm before any new orders.',
      createdAt: iso(-12),
    },
    {
      updateId: 'U-1006',
      patientId: 'P-1001',
      authorRole: 'nurse' as const,
      authorName: 'Nurse-A',
      text: 'P-1001 tolerating diet, vitals within normal limits at last manual check.',
      createdAt: iso(-6),
    },
  ];

  // --- Tasks: completed + unresolved, plus 1 missed (overdue) -----------
  const tasks: Task[] = [
    // Completed
    {
      taskId: 'T-2001',
      patientId: 'P-1001',
      assignee: 'Nurse-A',
      description: 'Manual vitals recorded on downtime form for P-1001.',
      priority: 'low',
      status: 'done',
      createdAt: iso(-120),
      updatedAt: iso(-100),
    },
    {
      taskId: 'T-2002',
      patientId: 'P-1004',
      assignee: 'Nurse-B',
      description: 'Confirm hourly neuro-check schedule with Charge-Nurse-1.',
      priority: 'medium',
      status: 'done',
      createdAt: iso(-110),
      updatedAt: iso(-95),
    },
    // Unresolved (in progress / open)
    {
      taskId: 'T-2003',
      patientId: 'P-1003',
      assignee: 'Nurse-B',
      description: 'Reassess P-1003 pain and document score on downtime form.',
      priority: 'medium',
      status: 'in-progress',
      createdAt: iso(-40),
      updatedAt: iso(-20),
    },
    {
      taskId: 'T-2004',
      patientId: 'P-1002',
      assignee: 'Nurse-A',
      description: 'Verify P-1002 allergy list against last known records before new orders.',
      priority: 'medium',
      status: 'open',
      createdAt: iso(-11),
      updatedAt: iso(-11),
      dueAt: iso(60),
    },
    // The missed task: past due and still open.
    {
      taskId: 'T-2005',
      patientId: 'P-1004',
      assignee: 'Nurse-B',
      description: 'MISSED: 15:00 hourly neuro check for P-1004 not completed during outage.',
      priority: 'high',
      status: 'open',
      createdAt: iso(-150),
      updatedAt: iso(-150),
      dueAt: iso(-25), // overdue -> counts as a missed/overdue task
    },
  ];

  // --- Staffing gap (1) --------------------------------------------------
  const staffingGaps: StaffingGap[] = [{ area: 'Unit 4B', needed: 3, available: 2 }];

  // --- AI priority queue (pending recommendations for review) -----------
  const queue: QueueItem[] = [
    {
      patient: patients[1]!,
      update: updates[0]!, // the urgent update U-1001
      analysis: {
        analysisId: 'AN-3001',
        updateId: 'U-1001',
        patientId: 'P-1002',
        model: 'demo',
        createdAt: iso(-37),
        urgency: 'CRITICAL',
        risks: [
          'Scheduled antibiotic missed during outage may worsen infection.',
          'Oxygen saturation trending downward (93-94%).',
        ],
        unresolved_tasks: ['Confirm and administer overdue antibiotic per existing order.'],
        recommended_follow_up: ['Recheck vitals within 30 minutes', 'Notify Charge-Nurse-1'],
        handoff_summary:
          'Febrile patient with an antibiotic dose missed during the outage and mild desaturation; needs prompt human review of medication timing and close monitoring.',
        confidence: 0.72,
        evidence_update_ids: ['U-1001', 'U-1005'],
        requires_human_review: true,
      },
      recommendation: {
        recId: 'REC-4001',
        type: 'assignment',
        patientId: 'P-1002',
        updateId: 'U-1001',
        content: {
          description: 'Confirm and administer overdue antibiotic per existing order.',
          suggestedAssignee: 'Nurse-A',
        },
        priority: 'high',
        priorityRank: 101,
        rationale: 'Derived from AI analysis (urgency CRITICAL, confidence 0.72).',
        status: 'pending',
        createdAt: iso(-37),
      },
    },
    {
      patient: patients[2]!,
      update: updates[2]!,
      analysis: {
        analysisId: 'AN-3002',
        updateId: 'U-1003',
        patientId: 'P-1003',
        model: 'demo',
        createdAt: iso(-21),
        urgency: 'HIGH',
        risks: ['Uncontrolled pain; prior PRN timing unknown during outage.'],
        unresolved_tasks: ['Reassess pain and verify last PRN before re-dosing.'],
        recommended_follow_up: ['Document pain score', 'Verify medication timing manually'],
        handoff_summary:
          'Patient reporting moderate pain with uncertain last-dose timing; a human should verify timing before any action.',
        confidence: 0.64,
        evidence_update_ids: ['U-1003'],
        requires_human_review: true,
      },
      recommendation: {
        recId: 'REC-4002',
        type: 'assignment',
        patientId: 'P-1003',
        updateId: 'U-1003',
        content: {
          description: 'Reassess pain and verify last PRN before re-dosing.',
          suggestedAssignee: 'Nurse-B',
        },
        priority: 'high',
        priorityRank: 201,
        rationale: 'Derived from AI analysis (urgency HIGH, confidence 0.64).',
        status: 'pending',
        createdAt: iso(-21),
      },
    },
  ];

  // --- Audit history (seeded; grows as the charge nurse acts) -----------
  const audit = [
    {
      entryId: 'AUD-5001',
      actorRole: 'charge-nurse',
      actorName: 'Charge-Nurse-1',
      action: 'outage-activated',
      targetId: 'OUTAGE',
      createdAt: iso(-55),
    },
    {
      entryId: 'AUD-5002',
      actorRole: 'nurse',
      actorName: 'Nurse-A',
      action: 'recommendation-generated',
      targetId: 'REC-4001',
      createdAt: iso(-37),
    },
    {
      entryId: 'AUD-5003',
      actorRole: 'nurse',
      actorName: 'Nurse-B',
      action: 'recommendation-generated',
      targetId: 'REC-4002',
      createdAt: iso(-21),
    },
  ];

  // --- Active EHR outage -------------------------------------------------
  return {
    outage: {
      status: 'active',
      startedAt: iso(-55),
      actor: 'Charge-Nurse-1',
      incidentType: 'EHR outage',
      affectedSystems: ['EHR', 'eMAR', 'Secure messaging'],
      note: 'Vendor maintenance overrun (synthetic demo incident).',
    },
    patients,
    updates,
    tasks,
    nurses,
    staffingGaps,
    queue,
    audit,
  };
}
