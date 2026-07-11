/**
 * Knowledge Extractor — Core Types
 *
 * Defines the data schemas for the post-execution delta detection engine.
 * Every extracted learning record, regardless of detection mode, conforms to
 * the Provenance Schema (FR-5).
 */

// ============================================================================
// Signal Types & Change Types (FR-2, FR-3, FR-4)
// ============================================================================

/**
 * How a learning was detected.
 * - EXPLICIT: Agent self-reported via LearningSignal events during execution.
 * - IMPLICIT: Diff-based detection from pre/post knowledge snapshots.
 * - BEHAVIORAL: Inferred from action-path divergence in the execution trace.
 */
export type SignalType = "EXPLICIT" | "IMPLICIT" | "BEHAVIORAL";

/**
 * The nature of the change detected.
 * For EXPLICIT/IMPLICIT modes:
 * - ADDITION: New knowledge (node, edge, belief) appeared.
 * - MODIFICATION: Existing knowledge changed.
 * - RETRACTION: A belief was abandoned/deprecated.
 * For BEHAVIORAL mode:
 * - STRATEGY_CHANGE: Different tool/approach selected mid-task.
 * - ERROR_RECOVERY: Deviation triggered by a failure event.
 * - OPTIMIZATION: Shortened/more efficient path to same outcome.
 */
export type ChangeType =
  | "ADDITION"
  | "MODIFICATION"
  | "RETRACTION"
  | "STRATEGY_CHANGE"
  | "ERROR_RECOVERY"
  | "OPTIMIZATION";

// ============================================================================
// Status values for learning records (FR-5.1, FR-6.2, FR-7)
// ============================================================================

/**
 * CANDIDATE  — freshly extracted, waiting for dedup + confidence gating.
 * ACCEPTED  — passed all checks, persisted to live knowledge store.
 * REJECTED  — confidence below threshold, quarantined (FR-6.2).
 * DUPLICATE — semantically identical to a higher-confidence existing entry.
 * CONFLICT  — contradictory to an existing high-confidence entry (FR-7.3).
 */
export type LearningStatus = "CANDIDATE" | "ACCEPTED" | "REJECTED" | "DUPLICATE" | "CONFLICT";

// ============================================================================
// RunContext — the payload passed to the extractor (FR-1.1)
// ============================================================================

/**
 * A snapshot of the agent's knowledge graph/belief state at a point in time.
 * Serialized representation of the active knowledge graph.
 */
export type KnowledgeSnapshot = Record<string, unknown>;

/**
 * A single step/tool-call in the execution trace.
 */
export interface TraceEvent {
  /** Index in the execution sequence (0-based). */
  index: number;
  /** The tool or action invoked. */
  action: string;
  /** Input parameters. */
  input: unknown;
  /** Output or result. */
  output: unknown;
  /** Timestamp of the event. */
  timestamp: string;
  /** Duration of the event in milliseconds. */
  durationMs?: number;
  /** Whether the event indicated a failure. */
  isError?: boolean;
  /** Error message if isError is true. */
  errorMessage?: string;
}

/**
 * A learning signal emitted by an agent during execution (FR-2.1).
 */
export interface LearningSignal {
  signal_type: "EXPLICIT";
  content: string;
  rationale: string | null;
  confidence_hint?: number; // 0.0–1.0
}

/**
 * The full execution context supplied to the extractor (FR-1.1).
 */
export interface RunContext {
  run_id: string;
  task_id: string;
  agent_id: string;
  timestamp_start: string;
  timestamp_end: string;
  trigger_event: string;
  pre_snapshot: KnowledgeSnapshot;
  post_snapshot: KnowledgeSnapshot;
  execution_trace: {
    /** Ordered list of trace events. */
    events: TraceEvent[];
    /** If the agent recorded an anticipated action path at task-start (FR-4.5). */
    anticipated_path?: TraceEvent[];
    /** LearningSignal events emitted during execution. */
    learning_signals?: LearningSignal[];
  };
}

// ============================================================================
// LearningRecord — the provenance schema (FR-5)
// ============================================================================

/**
 * Every extracted learning record conforms to this schema.
 */
export interface LearningRecord {
  /** Globally unique, deterministically derived from run_id + signal_type + content hash (FR-5.1). */
  learning_id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  trigger_event: string;
  signal_type: SignalType;
  change_type: ChangeType;
  content: string;
  /** Prior value for MODIFICATION/RETRACTION (FR-3.5), null otherwise. */
  previous_value: string | null;
  /** Why this learning matters (optional, from agent self-report or template). */
  rationale: string | null;
  /** Computed by the Confidence Scoring Engine (FR-5.2, FR-6). */
  confidence_score: number;
  /** ISO-8601 timestamp when extraction ran. */
  extraction_timestamp: string;
  /** Semver string identifying extractor version (FR-5.3). */
  extractor_version: string;
  /** Lifecycle status after dedup + confidence gating. */
  status: LearningStatus;
}

// ============================================================================
// ExtractionReport — emitted upon pipeline completion (FR-8.2)
// ============================================================================

export interface ExtractionReport {
  run_id: string;
  /** Counts of records by mode. */
  counts_by_mode: Record<SignalType, number>;
  /** Counts of records by final status. */
  counts_by_status: Record<LearningStatus, number>;
  /** Aggregate confidence stats. */
  confidence_distribution: {
    mean: number;
    min: number;
    max: number;
    median: number;
  };
  /** Any warnings emitted during extraction. */
  warnings: ExtractionWarning[];
  /** Total pipeline duration in milliseconds. */
  duration_ms: number;
  /** Whether the pipeline hit the timeout (FR-1.3). */
  timed_out: boolean;
  /** The extractor version used. */
  extractor_version: string;
}

export interface ExtractionWarning {
  code: "TIMEOUT" | "MISSING_BASELINE" | "CONFLICT" | "NO_CHANGES" | "EMPTY_SIGNAL" | "DUPLICATE_SKIPPED";
  message: string;
}

// ============================================================================
// Extractor configuration
// ============================================================================

export interface ExtractorConfig {
  /** max wall-clock time in ms (default 30000). */
  timeoutMs: number;
  /** Minimum confidence to accept a record (default 0.60). */
  acceptThreshold: number;
  /** Records below this threshold are rejected (default 0.40). */
  rejectThreshold: number;
  /** Minimum delta magnitude for implicit mode (default 0.05). */
  minSignificance: number;
  /** Behavioral mode confidence floor (default 0.30). */
  behavioralConfidenceFloor: number;
  /** Behavioral mode confidence ceiling (default 0.75). */
  behavioralConfidenceCeiling: number;
  /** Cosine similarity threshold for dedup (default 0.92). */
  duplicateSimilarityThreshold: number;
  /** Path to the immutable audit log. */
  auditLogPath?: string;
  /** Max trace events to process before truncating (default 10000). */
  maxTraceEvents: number;
}

export const DEFAULT_EXTRACTOR_CONFIG: ExtractorConfig = {
  timeoutMs: 30_000,
  acceptThreshold: 0.60,
  rejectThreshold: 0.40,
  minSignificance: 0.05,
  behavioralConfidenceFloor: 0.30,
  behavioralConfidenceCeiling: 0.75,
  duplicateSimilarityThreshold: 0.92,
  maxTraceEvents: 10_000,
};

// ============================================================================
// Extractor version — change with every schema-breaking update (FR-5.3)
// ============================================================================

export const EXTRACTOR_VERSION = "1.0.0";