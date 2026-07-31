// types.ts — common DTOs for parallelization-plan analysis (PRD FR-1 to FR-6)

/** Supported input formats for task ingestion (FR-1.1) */
export type InputFormat = "json" | "yaml" | "plain";

/** Supported output formats for plan export (FR-3.3) */
export type OutputFormat = "json" | "yaml" | "markdown";

// ---------------------------------------------------------------------------
// Task input (FR-1.2)
// ---------------------------------------------------------------------------

export interface TaskInput {
  id: string;
  name: string;
  description?: string;
  /** IDs of tasks that must complete before this one can start */
  depends_on?: string[];
  /** Estimated wall-clock duration in minutes; optional */
  estimated_duration?: number;
}

// ---------------------------------------------------------------------------
// Parallelization plan output (FR-3)
// ---------------------------------------------------------------------------

export interface ParallelPlan {
  metadata: PlanMetadata;
  waves: Wave[];
  /** Human-readable critical-path summary string */
  critical_path_summary: string;
  summary: Summary;
}

export interface Wave {
  /** 1-based wave number */
  wave_number: number;
  task_ids: string[];
  task_names: string[];
  /** Ceiling: the maximum estimated_duration of any task in this wave */
  max_duration: number;
  /** Sum of all task durations in this wave (for reference; not the wave elapsed time) */
  total_duration: number;
}

export interface PlanMetadata {
  input_task_count: number;
  wave_count: number;
  critical_path_length: number;
  created_at: string; // ISO-8601
}

export interface Summary {
  /** Sum of all task estimated_duration values */
  sequential_total_time: number;
  /** Sum of max_duration per wave */
  parallelized_total_time: number;
  /** (sequential - parallelized) / sequential * 100, rounded to 2 decimals */
  time_saved_percentage: number;
  total_waves: number;
  tasks_in_critical_path: number;
}

// ---------------------------------------------------------------------------
// Dependency graph (FR-2, FR-4)
// ---------------------------------------------------------------------------

export interface DependencyGraph {
  nodes: Node[];
  edges: Edge[];
  /** Node IDs on the critical path (longest chain), in order */
  critical_path_nodes: string[];
  /** Edges that belong to the critical path */
  critical_path_edges: Edge[];
}

export interface Node {
  id: string;
  name: string;
  /** Number of incoming dependency edges */
  in_degree: number;
  /** Number of outgoing dependency edges */
  out_degree: number;
}

export interface Edge {
  /** Source (prerequisite) task ID */
  from: string;
  /** Target (dependent) task ID */
  to: string;
  /** Duration of the source task, if available */
  duration: number | undefined;
}

// ---------------------------------------------------------------------------
// Error handling (FR-5, AC-7)
// ---------------------------------------------------------------------------

export interface AnalysisError {
  error_code: string;
  message: string;
  details?: ErrorDetail;
}

export interface ErrorDetail {
  /** For circular dependencies: the cycle path; for unknown refs: the bad IDs */
  cause: string[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// API response types (FR-6.1)
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Supported output format for the API */
export type PlanOutputFormat = "json" | "yaml" | "markdown" | "dot" | "mermaid";

/** The plan object with optional dependency graph embedded */
export interface ParallelPlanWithGraph extends ParallelPlan {
  /** Embed the dependency graph for convenience (FR-4) */
  graph: DependencyGraph;
}

/**
 * The result of planParallel — either a plan or an error, never both.
 * This is the structured API response (FR-6.1, FR-5.1).
 */
export interface PlanOutput {
  plan?: ParallelPlanWithGraph;
  formatted?: string;
  error?: PlanError;
  warnings?: string[];
}

/**
 * Structured error object (FR-5.1, AC-7).
 */
export interface PlanError {
  error_code: string;
  message: string;
  details?: Record<string, unknown>;
}
