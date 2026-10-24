/**
 * CareBridge shared domain types.
 *
 * These types are the single source of truth for the data model and the API
 * request/response shapes described in `.kiro/specs/carebridge-mvp/design.md`.
 * They are imported by the Lambda handlers and by the frontend API client so the
 * two stay in sync.
 *
 * Invariants reflected here:
 * - A `NurseUpdate` is immutable once created. AI output (Extraction,
 *   Recommendation, summaries) is stored as SEPARATE records that reference the
 *   update by `updateId`; nothing overwrites the original text.
 * - AI output is advisory. A `Recommendation` becomes a `Task` only after an
 *   explicit charge-nurse decision.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp, e.g. "2026-10-23T14:00:00Z". */
export type IsoDateTime = string;

export type Severity = 'low' | 'medium' | 'high';
export type Urgency = 'low' | 'medium' | 'high';
export type Priority = 'low' | 'medium' | 'high';

/** Demo roles. Real auth (Cognito) is a stretch goal. */
export type Role = 'nurse' | 'charge-nurse';

/** Identity attached to each request via X-Demo-Role / X-Demo-User headers. */
export interface Actor {
  role: Role;
  name: string;
}

// ---------------------------------------------------------------------------
// Capability 2 — Crisis incident management
// ---------------------------------------------------------------------------

export type OutageStatus = 'normal' | 'active' | 'resolved';

export interface OutageState {
  status: OutageStatus;
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
  actor?: string;
  /** Optional incident metadata (stretch). */
  incidentType?: string;
  affectedSystems?: string[];
  note?: string;
}

export interface OutageActionRequest {
  action: 'activate' | 'deactivate';
  incidentType?: string;
  affectedSystems?: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Capability 3 — Synthetic patient continuity profiles
// ---------------------------------------------------------------------------

export interface Patient {
  patientId: string;
  /** Synthetic display name. No real patient data. */
  name: string;
  room: string;
  /** S3 key of the continuity packet, if seeded. */
  packetKey?: string;
}

export interface ListPatientsResponse {
  patients: Patient[];
}

// ---------------------------------------------------------------------------
// Capability 4 — Nurse update submission (immutable)
// ---------------------------------------------------------------------------

export interface SubmitUpdateRequest {
  patientId: string;
  /** Non-empty free text. Stored verbatim and never overwritten. */
  text: string;
}

export interface NurseUpdate {
  updateId: string;
  patientId: string;
  authorRole: Role;
  authorName: string;
  /** The original raw text. Immutable. */
  text: string;
  createdAt: IsoDateTime;
}

export interface ListUpdatesResponse {
  updates: NurseUpdate[];
}

// ---------------------------------------------------------------------------
// Capability 5 — Bedrock update processing
// ---------------------------------------------------------------------------

export interface RiskItem {
  description: string;
  severity: Severity;
}

export interface UnresolvedTaskItem {
  description: string;
  urgency: Urgency;
  /** ISO-8601 deadline or null when none was stated. */
  deadline: IsoDateTime | null;
}

export interface FollowUpItem {
  description: string;
}

/**
 * The JSON shape we require the Bedrock Converse model to return for extraction.
 * Validated before persistence; malformed output is rejected, never shown.
 */
export interface ExtractionResult {
  risks: RiskItem[];
  unresolvedTasks: UnresolvedTaskItem[];
  followUps: FollowUpItem[];
}

/** A persisted extraction, linked to its source update (original untouched). */
export interface Extraction extends ExtractionResult {
  extractionId: string;
  updateId: string;
  patientId: string;
  /** Bedrock model id that produced this extraction. */
  model: string;
  createdAt: IsoDateTime;
}

export interface ProcessUpdateResponse {
  extraction: Extraction;
  /** Newly created pending recommendations derived from the extraction. */
  recommendations: Recommendation[];
}

// ---------------------------------------------------------------------------
// Capability 5 (cont.) — Bedrock Converse analysis contract
//
// This is the strict JSON contract the Bedrock model must return for a single
// nurse update. It is stored as a SEPARATE record (`BedrockAnalysis`) linked to
// the original update by id; the original update is never modified. Field names
// here use snake_case to match the exact JSON the model is instructed to emit.
// ---------------------------------------------------------------------------

/** Four-level urgency scale used by the Bedrock analysis. */
export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** The raw JSON object the model must return (validated before persistence). */
export interface BedrockAnalysisPayload {
  urgency: UrgencyLevel;
  risks: string[];
  unresolved_tasks: string[];
  recommended_follow_up: string[];
  handoff_summary: string;
  /** Model self-reported confidence in [0, 1]. */
  confidence: number;
  /** Ids of updates the analysis drew evidence from. */
  evidence_update_ids: string[];
  /** Always true: a human must review before any action is taken. */
  requires_human_review: true;
}

/** A persisted Bedrock analysis, linked to its source update. */
export interface BedrockAnalysis extends BedrockAnalysisPayload {
  analysisId: string;
  updateId: string;
  patientId: string;
  /** Bedrock model id (from BEDROCK_MODEL_ID) that produced this analysis. */
  model: string;
  createdAt: IsoDateTime;
}

/** Inputs the Bedrock service receives to analyze a single update. */
export interface BedrockAnalysisInput {
  /** Synthetic patient continuity profile / packet context. */
  patientProfile: Patient & { continuity?: string };
  /** The original nurse update being analyzed. */
  update: NurseUpdate;
  /** Recent related updates for the same patient (chronological). */
  recentUpdates: NurseUpdate[];
  /** Active outage type, if an outage is active. */
  outageType?: string;
  /** Existing unresolved tasks for context (not to be re-created). */
  existingTasks: Task[];
}

/** Persisted record of an AI processing failure (no data loss on failure). */
export interface AiProcessingError {
  errorId: string;
  updateId: string;
  patientId: string;
  /** Machine-readable reason: why processing failed. */
  reason: 'invalid-json' | 'schema-validation' | 'bedrock-unavailable' | 'unknown';
  /** Safe, human-readable message (no internals leaked). */
  message: string;
  model: string;
  createdAt: IsoDateTime;
}

export interface ProcessUpdateSuccess {
  status: 'ok';
  analysis: BedrockAnalysis;
  /** Newly created pending recommendations derived from the analysis. */
  recommendations: Recommendation[];
}

export interface ProcessUpdateFallback {
  status: 'ai-unavailable';
  /** The original update is always returned intact. */
  update: NurseUpdate;
  error: AiProcessingError;
  /** Clear fallback message for the UI to display. */
  message: string;
}

export type ProcessUpdateResult = ProcessUpdateSuccess | ProcessUpdateFallback;

// ---------------------------------------------------------------------------
// Capability 6 — Charge nurse prioritization dashboard
// ---------------------------------------------------------------------------

export type IssueStatus = 'open' | 'assigned' | 'resolved';
export type IssueSource = 'extraction' | 'recommendation';

export interface Issue {
  issueId: string;
  patientId: string;
  patientName: string;
  title: string;
  rationale: string;
  priority: Priority;
  /** 1 = highest priority. */
  rank: number;
  source: IssueSource;
  status: IssueStatus;
}

export interface ListIssuesResponse {
  topIssue: Issue | null;
  issues: Issue[];
}

// ---------------------------------------------------------------------------
// Capability 7 — Human approval workflow
// ---------------------------------------------------------------------------

export type RecommendationType = 'assignment' | 'escalation' | 'status-change';
export type RecommendationStatus = 'pending' | 'approved' | 'rejected';

export interface RecommendationContent {
  description: string;
  suggestedAssignee?: string;
}

export interface Recommendation {
  recId: string;
  type: RecommendationType;
  patientId: string;
  updateId: string;
  content: RecommendationContent;
  priority: Priority;
  /** Lower rank = higher priority. */
  priorityRank: number;
  rationale: string;
  status: RecommendationStatus;
  /** Present when a charge nurse modified the recommendation before approval. */
  modifiedContent?: RecommendationContent;
  createdAt: IsoDateTime;
}

export type Decision = 'approve' | 'reject' | 'modify-approve';

export interface DecisionRequest {
  decision: Decision;
  /** Required for `modify-approve`. */
  content?: RecommendationContent;
  /** Optional free-text rationale (stretch). */
  note?: string;
}

export interface DecisionResponse {
  recommendation: Recommendation;
  /** Present on approve / modify-approve; absent on reject. */
  task?: Task;
}

export interface ListRecommendationsResponse {
  recommendations: Recommendation[];
}

// ---------------------------------------------------------------------------
// Capability 8 — Task assignment and status tracking
// ---------------------------------------------------------------------------

export type TaskStatus = 'open' | 'in-progress' | 'done';

export interface Task {
  taskId: string;
  patientId: string;
  assignee: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  /** Recommendation this task was created from, if any. */
  recId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateTaskRequest {
  patientId: string;
  assignee: string;
  description: string;
  priority: Priority;
}

export interface UpdateTaskRequest {
  status?: TaskStatus;
  description?: string;
  priority?: Priority;
}

export interface AssignTaskRequest {
  assignee: string;
}

export interface ListTasksResponse {
  tasks: Task[];
}

// ---------------------------------------------------------------------------
// Capability 9 — Policy assistant with citations
// ---------------------------------------------------------------------------

export interface PolicyAskRequest {
  question: string;
}

export interface Citation {
  title: string;
  s3Uri: string;
  snippet: string;
}

export interface PolicyAnswer {
  /** Concise answer grounded in retrieved policy, or the no-policy message. */
  answer: string;
  citations: Citation[];
  /** false => no supporting policy found; the UI should say so, not fabricate. */
  hasSupport: boolean;
  /**
   * When hasSupport is false, a recommended next step (e.g. contact the charge
   * nurse or supervisor). Omitted when a grounded answer is returned.
   */
  recommendation?: string;
}

// ---------------------------------------------------------------------------
// Capability 10 — Audit history
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'outage-activated'
  | 'outage-deactivated'
  | 'bedrock-called'
  | 'ai-processing-failed'
  | 'recommendation-generated'
  | 'recommendation-approved'
  | 'recommendation-rejected'
  | 'recommendation-modified'
  | 'task-created'
  | 'task-updated'
  | 'task-assigned';

export interface AuditEntry {
  entryId: string;
  actorRole: string;
  actorName: string;
  action: AuditAction;
  targetId?: string;
  /** Prior state for modifications. */
  before?: unknown;
  /** New state for modifications. */
  after?: unknown;
  createdAt: IsoDateTime;
}

export interface ListAuditResponse {
  entries: AuditEntry[];
}

// ---------------------------------------------------------------------------
// Capability 11 — Error handling
// ---------------------------------------------------------------------------

/** Standard error envelope returned by all handlers. */
export interface ApiError {
  error: string;
  details?: Record<string, unknown>;
}
