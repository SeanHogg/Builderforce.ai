// export.ts — output parallelization plans in JSON, YAML, Markdown, DOT, and Mermaid (FR-3.3, FR-4)

import type {
  ParallelPlan,
  DependencyGraph,
  Summary,
  PlanMetadata,
} from "./types";

// ---------------------------------------------------------------------------
// JSON (FR-3.3)
// ---------------------------------------------------------------------------

export function toJson(plan: ParallelPlan): string {
  return JSON.stringify(plan, null, 2);
}

// ---------------------------------------------------------------------------
// YAML (FR-3.3)
// ---------------------------------------------------------------------------

export function toYaml(plan: ParallelPlan): string {
  const lines: string[] = [];

  lines.push(`metadata:`);
  lines.push(`  input_task_count: ${plan.metadata.input_task_count}`);
  lines.push(`  wave_count: ${plan.metadata.wave_count}`);
  lines.push(`  critical_path_length: ${plan.metadata.critical_path_length}`);
  lines.push(`  created_at: ${plan.metadata.created_at}`);

  lines.push(`waves:`);
  for (const w of plan.waves) {
    lines.push(`  - wave_number: ${w.wave_number}`);
    lines.push(`    task_ids:`);
    for (const id of w.task_ids) {
      lines.push(`      - ${id}`);
    }
    lines.push(`    task_names:`);
    for (const name of w.task_names) {
      lines.push(`      - "${escapeYaml(name)}"`);
    }
    lines.push(`    max_duration: ${w.max_duration}`);
    lines.push(`    total_duration: ${w.total_duration}`);
  }

  lines.push(`critical_path_summary: "${escapeYaml(plan.critical_path_summary)}"`);

  lines.push(`summary:`);
  lines.push(`  sequential_total_time: ${plan.summary.sequential_total_time}`);
  lines.push(`  parallelized_total_time: ${plan.summary.parallelized_total_time}`);
  lines.push(`  time_saved_percentage: ${plan.summary.time_saved_percentage}`);
  lines.push(`  total_waves: ${plan.summary.total_waves}`);
  lines.push(`  tasks_in_critical_path: ${plan.summary.tasks_in_critical_path}`);

  return lines.join("\n") + "\n";
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Markdown table (FR-3.3)
// ---------------------------------------------------------------------------

export function toMarkdown(plan: ParallelPlan): string {
  const lines: string[] = [];

  lines.push(`# Parallelization Plan`);
  lines.push("");
  lines.push(`**Input tasks:** ${plan.metadata.input_task_count} | **Waves:** ${plan.metadata.wave_count} | **Critical path length:** ${plan.metadata.critical_path_length}`);
  lines.push("");

  // Summary table
  lines.push("## Time Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Sequential total time | ${plan.summary.sequential_total_time} min |`);
  lines.push(`| Parallelized total time | ${plan.summary.parallelized_total_time} min |`);
  lines.push(`| Time saved | ${plan.summary.time_saved_percentage}% |`);
  lines.push(`| Tasks in critical path | ${plan.summary.tasks_in_critical_path} |`);
  lines.push("");

  // Waves table
  lines.push("## Execution Waves");
  lines.push("");
  lines.push("| Wave | Tasks | Max Duration (min) |");
  lines.push("|---|---|---|");
  for (const w of plan.waves) {
    const taskList = w.task_names.map((n) => `\`${n}\``).join(", ");
    lines.push(`| ${w.wave_number} | ${taskList} | ${w.max_duration} |`);
  }
  lines.push("");

  // Critical path
  lines.push("## Critical Path");
  lines.push("");
  lines.push(plan.critical_path_summary);
  lines.push("");

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// DOT (Graphviz) representation (FR-4.1)
// ---------------------------------------------------------------------------

export function toDOT(graph: DependencyGraph): string {
  const lines: string[] = [];
  lines.push("digraph G {");
  lines.push("  rankdir=LR;");
  lines.push("  node [shape=box, style=rounded];");
  lines.push("");

  const cpNodeSet = new Set(graph.critical_path_nodes);
  const cpEdgeSet = new Set(
    graph.critical_path_edges.map((e) => `${e.from}→${e.to}`),
  );

  // Nodes
  for (const n of graph.nodes) {
    const attrs = cpNodeSet.has(n.id)
      ? 'color=red, penwidth=2, fontcolor=red'
      : '';
    lines.push(`  "${n.id}" [label="${escapeDot(n.name)}"${attrs ? `, ${attrs}` : ''}];`);
  }

  lines.push("");

  // Edges
  for (const e of graph.edges) {
    const attrs = cpEdgeSet.has(`${e.from}→${e.to}`)
      ? ' [color=red, penwidth=2, style=bold]'
      : '';
    lines.push(`  "${e.from}" -> "${e.to}"${attrs};`);
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}

function escapeDot(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ---------------------------------------------------------------------------
// Mermaid diagram (FR-4.2, AC-6)
// ---------------------------------------------------------------------------

export function toMermaid(graph: DependencyGraph): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("graph LR");
  lines.push("");

  const cpNodeSet = new Set(graph.critical_path_nodes);
  const cpEdgeSet = new Set(
    graph.critical_path_edges.map((e) => `${e.from}→${e.to}`),
  );

  // Declare critical-path nodes with a class (Mermaid supports classDef + class)
  const cpNodeIds: string[] = [];

  for (const n of graph.nodes) {
    const safeId = toMermaidId(n.id);
    const label = n.name.replace(/"/g, "'");
    if (cpNodeSet.has(n.id)) {
      lines.push(`  ${safeId}["${label}"]`);
      cpNodeIds.push(safeId);
    } else {
      lines.push(`  ${safeId}["${label}"]`);
    }
  }

  lines.push("");

  // Edges
  for (const e of graph.edges) {
    const fromId = toMermaidId(e.from);
    const toId = toMermaidId(e.to);
    if (cpEdgeSet.has(`${e.from}→${e.to}`)) {
      lines.push(`  ${fromId} ==> ${toId}`);
    } else {
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  lines.push("");

  // Style critical path nodes
  if (cpNodeIds.length > 0) {
    lines.push(`  classDef critical fill:#ffcccc,stroke:#ff0000,stroke-width:2px;`);
    lines.push(`  class ${cpNodeIds.join(",")} critical;`);
  }

  lines.push("```");
  return lines.join("\n") + "\n";
}

/**
 * Convert an arbitrary task ID to a valid Mermaid node identifier.
 * Mermaid IDs must be alphanumeric with no spaces.
 */
function toMermaidId(id: string): string {
  return "n" + id.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// Summary computation (FR-3.4)
// ---------------------------------------------------------------------------

export function computeSummary(
  waves: { max_duration: number }[],
  sequentialTotal: number,
  criticalPathLength: number,
): Summary {
  const parallelizedTotal = waves.reduce((s, w) => s + w.max_duration, 0);
  const timeSaved =
    sequentialTotal > 0
      ? Math.round(((sequentialTotal - parallelizedTotal) / sequentialTotal) * 10000) / 100
      : 0;

  return {
    sequential_total_time: sequentialTotal,
    parallelized_total_time: parallelizedTotal,
    time_saved_percentage: timeSaved,
    total_waves: waves.length,
    tasks_in_critical_path: criticalPathLength,
  };
}

export function buildMetadata(
  taskCount: number,
  waveCount: number,
  criticalPathLength: number,
): PlanMetadata {
  return {
    input_task_count: taskCount,
    wave_count: waveCount,
    critical_path_length: criticalPathLength,
    created_at: new Date().toISOString(),
  };
}
