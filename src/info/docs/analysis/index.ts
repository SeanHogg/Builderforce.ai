// index.ts — main entry point for the parallelization analysis API (FR-6.1)

import type {
  TaskInput,
  ParallelPlan,
  ParallelPlanWithGraph,
  PlanOutput,
  PlanOutputFormat,
  PlanError,
  InferenceConfig as InferenceConfigType,
} from "./types";
import { buildDAG } from "./dag";
import { computeWaves } from "./waves";
import { inferDependencies } from "./inference";
import { parseTasks } from "./ingestion";
import {
  toJson,
  toYaml,
  toMarkdown,
  toDOT,
  toMermaid,
  computeSummary,
  buildMetadata,
} from "./export";

export type { InferenceConfig as InferenceConfigType } from "./inference";

// Re-export types
export type {
  TaskInput,
  ParallelPlan,
  ParallelPlanWithGraph,
  PlanOutput,
  PlanOutputFormat,
  PlanError,
  Wave,
  DependencyGraph,
  PlanMetadata,
  Summary,
} from "./types";

// Re-export parsing functions
export { parseTasks } from "./ingestion";

/**
 * Full options for planParallel.
 */
export interface PlanParallelOptions {
  /** Enable/disable implicit dependency inference. Default: true. */
  inference?: boolean;
  /** Output format. Default: "json". */
  format?: PlanOutputFormat;
  /**
   * Inference configuration (only used when inference is enabled).
   */
  inferenceConfig?: Partial<InferenceConfigType>;
}

/**
 * Analyze a set of tasks and produce a parallelization plan.
 *
 * This is the primary API entry point (FR-6.1).  It:
 *  1. Ingests task records
 *  2. Optionally infers implicit dependencies
 *  3. Builds a DAG and detects cycles
 *  4. Computes execution waves
 *  5. Formats the output in the requested format
 *
 * Returns a `PlanOutput` that contains either a `plan` or an `error`,
 * never both (and never a raw exception — FR-5.1).
 */
export function planParallel(
  tasks: TaskInput[],
  options: PlanParallelOptions = {},
): PlanOutput {
  // ---- Validation (FR-5.1 — empty input) ----
  if (!tasks || tasks.length === 0) {
    return {
      error: makeError("EMPTY_INPUT", "Task list is empty or undefined.", {
        task_count: 0,
      }),
    };
  }

  // Validate tasks have unique IDs
  const ids = new Set<string>();
  const dupes: string[] = [];
  for (const t of tasks) {
    if (!t.id || ids.has(t.id)) {
      dupes.push(t.id ?? "<empty>");
    }
    if (t.id) ids.add(t.id);
  }
  if (dupes.length > 0) {
    return {
      error: makeError("DUPLICATE_IDS", `Duplicate or missing task IDs found`, {
        duplicates: dupes,
      }),
    };
  }

  // ---- Step 1: Infer implicit dependencies (FR-1.3, FR-1.4) ----
  let enriched = tasks.map((t) => ({ ...t, depends_on: [...(t.depends_on ?? [])] }));
  if (options.inference !== false) {
    enriched = inferDependencies(enriched, options.inferenceConfig ?? {});
  }

  // ---- Step 2: Build DAG & detect cycles (FR-2.1, FR-2.2, FR-5.1) ----
  const dagResult = buildDAG(enriched);
  if ("error_code" in dagResult) {
    return { error: dagResult };
  }
  const graph = dagResult; // buildDAG returns DependencyGraph directly

  // ---- Step 3: Compute waves (FR-3.1, FR-3.2) ----
  const waves = computeWaves(graph, enriched);

  // ---- Step 4: Compute summary (FR-3.4) ----
  const sequentialTotal = enriched.reduce(
    (s, t) => s + (t.estimated_duration ?? 0),
    0,
  );
  const summary = computeSummary(
    waves,
    sequentialTotal,
    graph.critical_path_length,
  );

  const metadata = buildMetadata(
    enriched.length,
    waves.length,
    graph.critical_path_length,
  );

  // Build critical path narrative (FR-2.3)
  const cpNames = graph.critical_path_nodes
    .map((id) => enriched.find((t) => t.id === id)?.name ?? id)
    .join(" → ");

  const plan: ParallelPlanWithGraph = {
    metadata,
    waves,
    critical_path_summary: `Critical path (${graph.critical_path_length} tasks): ${cpNames}`,
    summary,
    graph: {
      nodes: graph.nodes,
      edges: graph.edges,
      critical_path_nodes: graph.critical_path_nodes,
      critical_path_edges: graph.critical_path_edges,
    },
  };

  // ---- Step 5: Format output (FR-3.3) ----
  const format = options.format ?? "json";
  return formatPlan(plan, format);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPlan(
  plan: ParallelPlanWithGraph,
  format: PlanOutputFormat,
): PlanOutput {
  switch (format) {
    case "json":
      return { plan, formatted: toJson(plan) };
    case "yaml":
      return { plan, formatted: toYaml(plan) };
    case "markdown":
      return { plan, formatted: toMarkdown(plan) };
    case "dot":
      return { plan, formatted: toDOT(plan.graph) };
    case "mermaid":
      return { plan, formatted: toMermaid(plan.graph) };
    default:
      return { plan, formatted: toJson(plan) };
  }
}

function makeError(
  code: string,
  message: string,
  details: Record<string, unknown>,
): PlanError {
  return { error_code: code, message, details };
}

/**
 * Convenience: parse + plan from a raw text input.
 * See `parseTasks` in ingestion.ts for supported formats.
 */
export function planParallelFromText(
  input: string,
  options: PlanParallelOptions & { format_hint?: string } = {},
): PlanOutput {
  const parseResult = parseTasks(input, options.format_hint as "json" | "yaml" | "plain" | undefined);
  if (Array.isArray(parseResult) && "error_code" in parseResult[0]) {
    return { error: parseResult[0] as PlanError };
  }
  if (Array.isArray(parseResult)) {
    return planParallel(parseResult, options);
  }
  if ("error_code" in parseResult) {
    return { error: parseResult };
  }
  return { error: { error_code: "UNKNOWN", message: "Unexpected parsing result" } };
}
