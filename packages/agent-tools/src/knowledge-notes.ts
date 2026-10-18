/**
 * knowledge-notes — the shared FORMAT of the `.builderforce/` knowledge loop's per-run
 * session notes, plus the heuristic that names what a run did.
 *
 * ## Why it is shared
 *
 * The knowledge loop compounds: every finished run appends a dated note to
 * `.builderforce/memory/<YYYY-MM-DD>.md`, and later runs read that history back as
 * grounding. It only compounds if the notes are the SAME shape — a surface that writes a
 * different heading, or names the same activity differently, contributes entries the next
 * run's grounding reads as unrelated noise.
 *
 * The on-prem runtime had the only implementation; the VS Code extension wrote the
 * grounding map (`context.yaml`, `project-map.md`, `architecture.md`) and an EMPTY
 * `memory/` directory, while the README it generated told the user that directory held
 * "session knowledge appended over time". Adding notes to the editor by copying the
 * formatter would have made drift a matter of time, so the formatter moved here first.
 *
 * PURE by construction: no `node:*`, no filesystem. It builds strings and file NAMES; each
 * surface joins and writes them with its own I/O, which is also what keeps this importable
 * from the Worker-safe package root.
 */

/** Directory names of the on-disk knowledge tree, so no surface spells them itself. */
export const KNOWLEDGE_DIRS = {
  /** Root of the per-workspace knowledge tree. */
  root: ".builderforce",
  /** Dated activity notes, appended to by every completed run. */
  memory: "memory",
  /** Structured per-session handoffs. */
  sessions: "sessions",
} as const;

/**
 * The memory file a note dated `at` belongs in — `2026-08-20.md`.
 *
 * One file per DAY, not per run: a run-per-file tree becomes thousands of entries a
 * grounding pass cannot cheaply read, while a single ever-growing file cannot be pruned
 * by age. Days are the unit both surfaces already agreed on.
 */
export function knowledgeMemoryFileName(at: Date = new Date()): string {
  return `${at.toISOString().slice(0, 10)}.md`;
}

/** What one completed run did, as the note format understands it. */
export interface RunActivity {
  /** Paths the run created. Duplicates are collapsed. */
  created?: readonly string[];
  /** Paths the run modified. Duplicates are collapsed. */
  edited?: readonly string[];
  /** Tool names the run invoked. Duplicates are collapsed. */
  tools?: readonly string[];
}

/**
 * Aliases from historical/other-surface tool names to the names the shared tools
 * actually register under (see `core-tools.ts`, `git-tools.ts`, `symbol-tools.ts`).
 *
 * The first run of this heuristic matched `grep` / `glob` / `view` / `test` /
 * `bash` / `code_analysis` / `project_knowledge` / `orchestrate` /
 * `workflow_status` — NONE of which is a registered tool in this package. Every
 * one of those branches was dead code: no run could ever satisfy it, so the
 * note degraded to the generic "Code modifications: N file(s) changed" and the
 * analysis/review/workflow labels were unreachable. Map the old names onto the
 * real ones so the branches are reachable from either spelling.
 */
const TOOL_ALIASES: Readonly<Record<string, string>> = {
  grep: "search_code",
  glob: "list_files",
  view: "read_file",
  bash: "run_command",
  shell: "run_command",
  test: "run_checks",
  code_analysis: "file_outline",
  project_knowledge: "semantic_search",
  orchestrate: "spawn_agent",
  workflow_status: "repo_map",
};

/** Canonicalise one tool name through {@link TOOL_ALIASES}; unknown names pass through. */
function canonicalTool(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/**
 * A short English label for what a run did, from the files it touched and the tools it
 * used. Rules are checked in priority order — the FIRST match wins, most specific first —
 * so a test-file edit reads as "Tests updated" rather than the generic edit count.
 *
 * Returns `''` when there was no activity at all, which is the caller's signal to write
 * no note rather than an empty one.
 */
export function deriveActivitySummary(activity: RunActivity): string {
  const created = [...new Set(activity.created ?? [])];
  const edited = [...new Set(activity.edited ?? [])];
  const tools = [...new Set((activity.tools ?? []).map(canonicalTool))];
  const hasCreate = created.length > 0;
  const hasEdit = edited.length > 0;
  const toolSet = new Set(tools);

  // A run that actually ran the project's checks is not merely "exploration" —
  // verify that first so `run_checks` never falls through to the read-only label.
  const ranChecks = toolSet.has("run_checks");

  const isTest =
    [...created, ...edited].some(
      (f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"),
    ) || ranChecks;

  // Read-only exploration: the agent only LOOKED. A run that also ran checks or
  // commands did more than read, so it must not be labelled as pure analysis.
  const isAnalysis =
    !hasCreate &&
    !hasEdit &&
    !ranChecks &&
    (toolSet.has("search_code") ||
      toolSet.has("list_files") ||
      toolSet.has("read_file") ||
      toolSet.has("find_symbol") ||
      toolSet.has("file_outline")) &&
    !toolSet.has("run_command");

  const isReview =
    toolSet.has("git_history") ||
    toolSet.has("git_diff") ||
    toolSet.has("file_outline") ||
    toolSet.has("semantic_search");

  const isOrchestration =
    toolSet.has("spawn_agent") ||
    toolSet.has("spawn_agents") ||
    toolSet.has("task_matches");

  const isShip =
    toolSet.has("git_commit") || toolSet.has("git_push") || toolSet.has("open_pull_request");

  if (isOrchestration) return "Multi-agent workflow execution";
  if (isReview) return "Code review / analysis";
  if (isTest && hasCreate) return "Test suite created";
  if (isTest && hasEdit) return "Tests updated";
  if (isAnalysis) return "Codebase exploration / read-only analysis";
  if (isShip) return "Change shipped (commit/push)";
  if (hasCreate && hasEdit) return "Feature implementation: new files + edits";
  if (hasCreate) return `New file(s) created: ${created.length}`;
  if (hasEdit) return `Code modifications: ${edited.length} file(s) changed`;
  if (tools.length > 0) return "Agent activity (no file changes)";
  return "";
}

/**
 * Render one appendable note, or `null` when the run did nothing worth recording.
 *
 * `null` is load-bearing: an empty note still costs the next grounding pass tokens to read
 * and tells it nothing, so a run with no files and no tools contributes NOTHING rather
 * than a heading. Only the lines with content are emitted, so an absent field stays
 * distinguishable from an empty one.
 *
 * The leading blank line makes the result safe to append to an existing file without the
 * caller tracking whether one is already there.
 */
export function buildKnowledgeMemoryEntry(params: {
  /** Which session/run this note describes. */
  sessionKey: string;
  /** ISO timestamp for the heading. */
  ts: string;
  activity?: RunActivity;
}): string | null {
  const lines: string[] = [`\n## [${params.ts}] session:${params.sessionKey}`, ""];
  let meaningful = false;

  if (params.activity) {
    const created = [...new Set(params.activity.created ?? [])];
    const edited = [...new Set(params.activity.edited ?? [])];
    const tools = [...new Set(params.activity.tools ?? [])];
    if (created.length > 0) {
      lines.push(`**Created**: ${created.join(", ")}`);
      meaningful = true;
    }
    if (edited.length > 0) {
      lines.push(`**Edited**: ${edited.join(", ")}`);
      meaningful = true;
    }
    if (tools.length > 0) {
      lines.push(`**Tools**: ${tools.join(", ")}`);
      meaningful = true;
    }
    const summary = deriveActivitySummary({ created, edited, tools });
    if (summary) {
      lines.push(`**Summary**: ${summary}`);
      meaningful = true;
    }
  }

  if (!meaningful) return null;
  lines.push("");
  return lines.join("\n");
}
