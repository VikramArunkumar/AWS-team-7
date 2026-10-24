/**
 * Frontend types.
 *
 * Domain types mirror the backend contract in
 * `backend/src/lib/types.ts` (kept in sync by hand for the MVP). Added here are
 * dashboard view-model types for panels that don't yet have a backend endpoint
 * (nurses, staffing gaps, unverified info); these are clearly demo-shaped and
 * served by the data provider so the dashboard is fully demoable now.
 */

export type IsoDateTime = string;
export type Priority = 'low' | 'medium' | 'high';
export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Role = 'nurse' | 'charge-nurse';

// --- Outage ---
export type OutageStatus = 'normal' | 'active' | 'resolved';
export interface OutageState {
  status: OutageStatus;
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
  actor?: string;
  incidentType?: string;
  affectedSystems?: string[];
  note?: string;
}

// --- Patient / update ---
export interface Patient {
  patientId: string;
  name: string;
  room: string;
  packetKey?: string;
  /** Whether continuity info has been verified by a human (demo view-model). */
  verified?: boolean;
}

export interface NurseUpdate {
  updateId: string;
  patientId: string;
  authorRole: Role;
  authorName: string;
  text: string;
  createdAt: IsoDateTime;
  /** Flagged by AI/heuristics as urgent (demo view-model). */
  urgent?: boolean;
}

// --- Bedrock analysis (separate from the original update) ---
export interface BedrockAnalysis {
  analysisId: string;
  updateId: string;
  patientId: string;
  model: string;
  createdAt: IsoDateTime;
  urgency: UrgencyLevel;
  risks: string[];
  unresolved_tasks: string[];
  recommended_follow_up: string[];
  handoff_summary: string;
  confidence: number;
  evidence_update_ids: string[];
  requires_human_review: true;
}

// --- Recommendation / decision ---
export type RecommendationStatus = 'pending' | 'approved' | 'rejected';
export interface RecommendationContent {
  description: string;
  suggestedAssignee?: string;
}
export interface Recommendation {
  recId: string;
  type: 'assignment' | 'escalation' | 'status-change';
  patientId: string;
  updateId: string;
  content: RecommendationContent;
  priority: Priority;
  priorityRank: number;
  rationale: string;
  status: RecommendationStatus;
  modifiedContent?: RecommendationContent;
  createdAt: IsoDateTime;
}

// --- Task ---
export type TaskStatus = 'open' | 'in-progress' | 'done';
export interface Task {
  taskId: string;
  patientId: string;
  assignee: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  recId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Due time; a task past due is overdue (demo view-model). */
  dueAt?: IsoDateTime;
}

// --- Staffing (demo view-model; no backend endpoint yet) ---
export interface Nurse {
  nurseId: string;
  name: string;
  /** Distinguishes a floor nurse from the charge nurse (demo view-model). */
  role?: Role;
  available: boolean;
  activePatients: number;
}

export interface StaffingGap {
  area: string;
  needed: number;
  available: number;
}

/**
 * A priority-queue item joins a recommendation to its source update, the AI
 * analysis, and the patient, so the charge nurse can review everything in one
 * card. The original update text and the AI analysis are kept distinct.
 */
export interface QueueItem {
  recommendation: Recommendation;
  analysis: BedrockAnalysis;
  update: NurseUpdate;
  patient: Patient;
  /** Present if AI processing failed for this update. */
  aiUnavailable?: boolean;
}

// --- Audit history (part of the core end-to-end path) ---
export interface AuditEntry {
  entryId: string;
  actorRole: string;
  actorName: string;
  action: string;
  targetId?: string;
  createdAt: IsoDateTime;
}

// --- Policy assistant (DEFERRED; types kept for the retained backend/service) ---
export interface Citation {
  title: string;
  s3Uri: string;
  snippet: string;
}
export interface PolicyAnswer {
  answer: string;
  citations: Citation[];
  hasSupport: boolean;
  recommendation?: string;
}

/** Everything the dashboard needs in one payload. */
export interface DashboardData {
  outage: OutageState;
  patients: Patient[];
  updates: NurseUpdate[];
  tasks: Task[];
  nurses: Nurse[];
  staffingGaps: StaffingGap[];
  queue: QueueItem[];
  audit: AuditEntry[];
}
