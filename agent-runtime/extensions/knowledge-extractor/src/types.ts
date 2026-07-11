/**
 * Knowledge Extractor — Core Types
 *
 * Defines the schema for every learning record, run context, extraction
 * configuration, and report emitted by the pipeline.
 *
 * See PRD section "FR-5: Provenance Schema" for field-level requirements.
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
export type LearningStatus = "CANDIDATE" | "ACCEPTED" | "REJECTED" | "DUPLICATE" | "CONFLICT";

/** Divergence classifications for behavioural mode. */
export type DivergenceClass = "STRATEGY_CHANGE" | "ERROR_RECOVERY" | "OPTIMIZATION";

/** Warnings the pipeline may emit. */
export type ExtractionWarning = "TIMEOUT" | "MISSING_BASELINE" | "CONFLICT";

// ============================================================================
// Input Types
// ============================================================================

/**
 * A structured learning signal emitted by an agent mid-execution.
 * Agents call an SDK interface; signals are buffered in the execution trace.
 */
export interface LearningSignal {
  signal_type: "EXPLICIT";
  content: string;
  rationale: string | null;
  confidence_hint?: number; // 0.0–1.0 (optional)
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
    confidence: number; // 0.0–1.0
    source?: string;
  }>;
}

/** An action recorded in the execution trace. */
export interface TraceAction {
  timestamp: number;
  tool_name: string;
  input: string;
  output: string;
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
  timestamp_start: string; // ISO-8601
  timestamp_end: string; // ISO-8601
  trigger_event: string;
  pre_snapshot: KnowledgeSnapshot;
  post_snapshot: KnowledgeSnapshot;
  execution_trace: TraceAction[];
  learning_signals: LearningSignal[];
  anticipated_actions: AnticipatedAction[];
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * A single extracted learning record — the canonical output of the extractor.
 * Every field conforms to the provenance schema defined in FR-5.
 */
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
  confidence_score: number;
  extraction_timestamp: string; // ISO-8601
  extractor_version: string; // semver
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

/** The report emitted to the event bus after extraction completes (FR-8.2). */
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
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configurable thresholds and settings for the extraction pipeline.
 * All numeric thresholds are injectable per agent type / task domain (FR-6.3).
 */
export interface ExtractorConfig {
  /** Max wall-clock time for the full pipeline (ms). Default: 30 000. */
  timeoutMs: number;

  /** Minimum confidence to auto-accept (FR-6.2). Default: 0.60. */
  acceptThreshold: number;

  /** Maximum confidence to auto-reject. Default: 0.40. */
  rejectThreshold: number;

  /** Minimum delta magnitude to keep an implicit diff (FR-3.4). Default: 0.05. */
  minSignificance: number;

  /** Baseline confidence floor for behavioural records (FR-4.4). Default: 0.30. */
  behavioralConfidenceFloor: number;

  /** Baseline confidence ceiling for behavioural records (FR-4.4). Default: 0.75. */
  behavioralConfidenceCeiling: number;

  /** Cosine similarity above which two records are considered duplicates (FR-7.1). Default: 0.92. */
  duplicateSimilarityThreshold: number;

  /** Path to the immutable append-only audit log. */
  auditLogPath: string;

  /** Max execution trace events to process before truncating for performance (AC-9). Default: 10000. */
  maxTraceEvents: number;
}

export const DEFAULT_EXTRACTOR_CONFIG: ExtractorConfig = {
  timeoutMs: 30_000,
  acceptThreshold: 0.6,
  rejectThreshold: 0.4,
  minSignificance: 0.05,
  behavioralConfidenceFloor: 0.3,
  behavioralConfidenceCeiling: 0.75,
  duplicateSimilarityThreshold: 0.92,
  auditLogPath: "",
  maxTraceEvents: 10_000,
};

// ============================================================================
// Diff Types (Implicit Mode)
// ============================================================================

export type DiffType = "ADDITION" | "MODIFICATION" | "RETRACTION";

export interface KnowledgeDiff {
  type: DiffType;
  path: string; // dot-notation path within the snapshot
  previous_value: unknown;
  current_value: unknown;
  magnitude: number; // normalized 0–1
}

// ============================================================================
// Dedup Quarantine & Conflict
// ============================================================================

export interface ConflictEntry {
  existing_record: LearningRecord;
  incoming_record: LearningRecord;
  reason: string;
  detected_at: string;
}