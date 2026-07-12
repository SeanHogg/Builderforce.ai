/** * Knowledge Extractor — Core Types
 * 
 * Defines the schema for every learning record, run context, extraction
 * configuration, and report emitted by the pipeline.
 * 
 * PRD sections: FR-5 (Provenance Schema), FR-6 (Confidence model), FR-8 (ExtractionReport)
 */

// ============================================================================
// Enums & Constants
// ============================================================================

/** The three detection modes a learning signal can originate from. */
export type SignalType = "EXPLICIT" | "IMPLICIT" | "BEHAVIORAL";

/** The classification of a change detected by any mode. */
export type ChangeType =
  | "ADDITION"
  | "MODIFICATION"
  | "RETRACTION"
  | "STRATEGY_CHANGE"
  | "ERROR_RECOVERY"
  | "OPTIMIZATION";

/** Lifecycle status of a learning record after the extraction pipeline. */
export type LearningStatus =
  | "CANDIDATE"
  | "ACCEPTED"
  | "REJECTED"
  | "DUPLICATE"
  | "CONFLICT";

/** Behavioral divergence classifications for behavioral mode. */
export type DivergenceClass = "STRATEGY_CHANGE" | "ERROR_RECOVERY" | "OPTIMIZATION";

/** Warnings the pipeline may emit (FR-8). */
export type ExtractionWarning = "TIMEOUT" | "MISSING_BASELINE" | "CONFLICT";

// ============================================================================
// Input Types
// ============================================================================

/** An action recorded in the execution trace. */
export interface TraceAction {
  timestamp: number;
  tool_name: string;
  input: string;
  output: string | null;
  error: string | null;
  duration_ms: number;
}

/** A divergence point recorded when the agent deviates from its anticipated path. */
export interface AnticipatedAction {
  step_index: number;
  description: string;
  expected_tool: string;
  timestamp: number;
}

/** Full context the extractor receives for every extraction run. */
export interface RunContext {
  run_id: string;
  task_id: string;
  agent_id: string;
  timestamp_start: string;
  timestamp_end: string;
  trigger_event: string;
  pre_snapshot: KnowledgeSnapshot;
  post_snapshot: KnowledgeSnapshot;
  execution_trace: TraceAction[];
  learning_signals: LearningSignal[];
  anticipated_actions: AnticipatedAction[];
}

/** A structured learning signal emitted by an agent mid-execution. */
export interface LearningSignal {
  signal_type: "EXPLICIT";
  content: string;
  rationale: string | null;
  confidence_hint?: number;
}

/** Pre- or post-execution snapshot of the agent's knowledge graph / belief state. */
export interface KnowledgeSnapshot {
  nodes: Array<{
    id: string;
    label: string;
    attributes: Record<string, unknown>;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    label?: string;
  }>;
  beliefs: Array<{
    statement: string;
    confidence: number;
    source?: string;
  }>;
}

// ============================================================================
// Output Types
// ============================================================================

/** A single extracted learning record — the canonical output of the extractor. */
export interface LearningRecord {
  learning_id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  trigger_event: string;
  signal_type: SignalType;
  change_type: ChangeType;
  content: string;
  previous_value: string | null;
  rationale: string | null;
  confidence_score: number; // float in [0,1]
  extraction_timestamp: string;
  extractor_version: string;
  status: LearningStatus;
}

/** Aggregated counts by mode and status for the extraction report. */
export interface ModeCounts {
  EXPLICIT: number;
  IMPLICIT: number;
  BEHAVIORAL: number;
}

export interface StatusCounts {
  CANDIDATE: number;
  ACCEPTED: number;
  REJECTED: number;
  DUPLICATE: number;
  CONFLICT: number;
}

/** The report emitted to the event bus after extraction completes (FR-8). */
export interface ExtractionReport {
  run_id: string;
  task_id: string;
  agent_id: string;
  counts_by_mode: ModeCounts;
  counts_by_status: StatusCounts;
  confidence_distribution: {
    min: number;
    max: number;
    mean: number;
    median: number;
  };
  warnings: ExtractionWarning[];
  extraction_duration_ms: number;
  timed_out: boolean;
  partial: Partial<LearningRecord[]> | null;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configurable thresholds and settings for the extraction pipeline.
 * All numeric thresholds are injectable per agent type / task domain.
 */
export interface ExtractorConfig {
  /** Max wall-clock time for the full pipeline (ms). Default: 30000. */
  timeoutMs: number;

  /** Minimum confidence to auto-accept. Default: 0.60 */
  acceptThreshold: number;

  /** Maximum confidence to auto-reject. Default: 0.40 */
  rejectThreshold: number;

  /** Minimum delta magnitude to keep an implicit diff. Default: 0.05 */
  minSignificance: number;

  /** Baseline confidence floor for behavioural records. Default: 0.30 */
  behavioralConfidenceFloor: number;

  /** Baseline confidence ceiling for behavioural records. Default: 0.75 */
  behavioralConfidenceCeiling: number;

  /** Cosine similarity above which two records are considered duplicates. Default: 0.92 */
  duplicateSimilarityThreshold: number;

  /** Path to the immutable append-only audit log. */
  auditLogPath: string;

  /** Max execution trace events (performance guard). Default: 10000 */
  maxTraceEvents: number;
}

/**
 * Defined in PRD FR-6.1:
 * Signal type weight (EXPLICIT > IMPLICIT > BEHAVIORAL): 0.30
 * Agent-provided hint (if present): 0.20
 * Delta magnitude / divergence severity: 0.25
 * Corroboration across multiple modes: 0.25
 */
const WEIGHTS = {
  signalType: 0.30,
  confidenceHint: 0.20,
  deltaMagnitude: 0.25,
  crossModeCorroboration: 0.25,
} as const;

// Empirical factor that NO PRD section quantifies but is needed for all zero-edge cases.
// Taking an order-of-magnitude from full-res contributions to keep all four arms summed to 1.
const ARBITRARY_ZERO_TOLERANCE_SCALER = 4.0;

/** Use computeBranchWeight / computeSignalWeight instead of accessing WEIGHTS directly. */
export { WEIGHTS as globalWeights };

export const DEFAULT_EXTRACTOR_CONFIG: ExtractorConfig = {
  timeoutMs: 30_000,
  acceptThreshold: 0.60,
  rejectThreshold: 0.40,
  minSignificance: 0.05,
  behavioralConfidenceFloor: 0.30,
  behavioralConfidenceCeiling: 0.75,
  duplicateSimilarityThreshold: 0.92,
  auditLogPath: "",
  maxTraceEvents: 10_000,
};

// ============================================================================
// Implicit Diff Types
// ============================================================================

/** Type of delta extracted from a pair of snapshots. */
export type DiffType = "ADDITION" | "MODIFICATION" | "RETRACTION";

/** A detected delta above the significance threshold. */
export interface KnowledgeDiff {
  type: DiffType;
  path: string;
  previous_value: unknown;
  current_value: unknown;
  magnitude: number;
}

// ============================================================================
// Dedup Quarantine & Conflict
// ============================================================================

/** An entry stored in the quarantine/lag log when a record is rejected (FR-6.2). */
export interface QuarantineEntry {
  learning_id: string;
  record: LearningRecord;
  reason: string;
  buffered_at: string;
}

/** A detected conflict between an incoming record and an existing one (FR-7.3). */
export interface ConflictEntry {
  learning_id: string;
  incoming_record: LearningRecord;
  existing_record: LearningRecord;
  reason: string;
  detected_at: string;
}

/** An event emitted to the downstream bus when extraction completes. */
export interface ExtractionEvent {
  type: "Extraction completed";
  run_id: string;
  task_id: string;
  report: ExtractionReport;
}

/** An append-only event written to the audit log. */
export interface AuditLogEntry {
  type: "Learning";
  record: LearningRecord;
  event: ExtractionEvent;
  written_at: string;
}