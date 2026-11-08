/**
 * THE tool side-effect classifier: pure, dependency-free (no catalog import), so
 * policy gates (`spec.ts`), the VS Code client, the brain and agent-runtime can all
 * classify through it without an import cycle. The catalog-walking completeness
 * helpers live in `tool-mutation.ts`, which re-exports everything here.
 *
 * Never copy this table into a second engine: `scripts/check-single-tool-classifier.mjs`
 * fails CI if a second `TOOL_SIDE_EFFECT` / `isMutatingTool` / `evaluatePolicyGate`
 * definition appears outside this package. An unclassified name fails CLOSED
 * (mutating) everywhere.
 */

/**
 * Side effect of one catalog tool.
 * - `read` — no durable write.
 * - `verify` — in-run check (static-check / typecheck / test). Does not write the
 *   repo. Distinct from `read` so policy can require a verify without treating it
 *   as a mutation, and distinct from `mutate` so a shell-less surface cannot be
 *   told that `run_checks` wrote anything.
 * - `mutate` — writes the working tree, memory, coordination, or a child run.
 *
 * `run_command` stays `mutate`: a shell can delete as easily as it can `npm test`.
 * Container/on-prem in-run verify *uses* `run_command` to exec the planned
 * package scripts; that does not reclassify the tool.
 */
export type ToolSideEffect = "read" | "verify" | "mutate";

/** Every class, for validators and selectors (one list). */
export const TOOL_SIDE_EFFECTS: readonly ToolSideEffect[] = ["read", "verify", "mutate"];

/**
 * Exhaustive map: every registered tool has an entry, and every entry names a
 * registered tool. Adding a tool without classifying it fails CI.
 */
export const TOOL_SIDE_EFFECT = {
  // ── CORE_TOOLS (includes symbols, semantic, git) ──────────────────────────
  list_files: "read",
  search_code: "read",
  read_file: "read",
  find_symbol: "read",
  file_outline: "read",
  semantic_search: "read",
  repo_map: "read",
  read_compressed: "read",
  // Its answer cache under .builderforce/ is a cache, like the symbol index
  // find_symbol keeps there — no change the person would review.
  local_research: "read",
  // Shells out to the analyzers and writes their artifacts under
  // .builderforce/code-analysis/, so it is a working-tree write, not a read.
  analyze_codebase: "mutate",
  write_file: "mutate",
  edit_file: "mutate",
  delete_file: "mutate",
  run_checks: "verify",
  run_command: "mutate",
  // A background job's status is a read; stopping one kills processes.
  command_status: "read",
  command_stop: "mutate",
  git_status: "read",
  git_diff: "read",
  git_history: "read",
  git_sync_latest: "mutate",
  git_undo: "mutate",
  git_redo: "mutate",
  git_commit: "mutate",
  git_push: "mutate",
  open_pull_request: "mutate",
  git_cleanup_merged: "mutate",
  web_fetch: "read",
  web_search: "read",
  memory_recall: "read",
  memory_remember: "mutate",
  memory_forget: "mutate",
  claim_resource: "mutate",
  release_resource: "mutate",
  workspace_note: "mutate",
  workspace_read: "read",
  ask_human: "read",
  update_prd: "mutate",
  finish: "read",
  // ── SKILL_TOOLS ───────────────────────────────────────────────────────────
  skill_propose: "mutate",
  skill_list: "read",
  // ── SUBAGENT_TOOLS (includes live control verbs) ──────────────────────────
  spawn_agent: "mutate",
  spawn_agents: "mutate",
  wait_agents: "read",
  message_agent: "mutate",
  stop_agent: "mutate",
} as const satisfies Record<string, ToolSideEffect>;

export type ClassifiedToolName = keyof typeof TOOL_SIDE_EFFECT;

/** The classification of `name`, or `undefined` when it is not in the catalog. */
export function toolSideEffect(name: string): ToolSideEffect | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_SIDE_EFFECT, name)
    ? TOOL_SIDE_EFFECT[name as ClassifiedToolName]
    : undefined;
}

/** What a HOST says about a tool of its own that the shared catalog does not know (a page action, an MCP tool, a VS Code tool). */
export interface DeclaredToolEffect {
  mutates?: boolean;
}

/** The normal form of an `action` argument (`send-keys` and `send keys` are `send_keys`). */
export function normalizeAction(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized || undefined;
}

/**
 * THE classification every gate and confirm path acts on, in ONE precedence:
 *   1. the shared catalog entry;
 *   2. the host's own declaration (`{ mutates }`, either way - an explicit `true` beats the host read-only list);
 *   3. {@link HOST_READ_ONLY_TOOLS} (on-prem names, no declaration needed);
 *   4. a read-only `args.action` ({@link READ_ONLY_ACTIONS}) of a tool in {@link ACTION_DISPATCHED_HOST_TOOLS} (`process`/`cron` list|poll);
 *   5. `mutate` (fail closed).
 */
export function classifyTool(name: string, declared?: DeclaredToolEffect, args?: { action?: unknown }): ToolSideEffect {
  const cataloged = toolSideEffect(name);
  if (cataloged) return cataloged;
  if (declared?.mutates !== undefined) return declared.mutates ? "mutate" : "read";
  if (HOST_READ_ONLY_TOOLS.has(name.trim().toLowerCase())) return "read";
  const action = normalizeAction(args?.action);
  // `action` is a model-supplied argument: honoured ONLY for a tool that dispatches on it, never for an arbitrary name.
  if (action && READ_ONLY_ACTIONS.has(action) && isActionDispatchedHostTool(name)) return "read";
  return "mutate";
}

/**
 * True when `name` writes. Unclassified names fail closed (mutating) unless the
 * host declared `mutates: false`; the completeness test is what makes an
 * unclassified catalog tool a CI failure rather than a silent production surprise.
 * `verify` is not a write.
 */
export function isMutatingTool(name: string, declared?: DeclaredToolEffect): boolean {
  return classifyTool(name, declared) === "mutate";
}

/** True when `name` is an in-run check (static-check / typecheck / test). */
export function isVerifyTool(name: string): boolean {
  return toolSideEffect(name) === "verify";
}

/** The word a class goes by in rendered policy text ("any mutating tool"). */
export function sideEffectLabel(effect: ToolSideEffect): string {
  return effect === "mutate" ? "mutating" : effect === "verify" ? "verification" : "read-only";
}

/** An `inject-directive` gate's text with its class kept in it, so a renderer that drops `sideEffect` still says what it governs. */
export function classScopedDirective(directive: string, sideEffect?: ToolSideEffect): string {
  return directive && sideEffect ? `For any ${sideEffectLabel(sideEffect)} tool: ${directive}` : directive;
}

/**
 * On-prem host tools (a different catalog from the shared one: `read`, `grep`, …) that never
 * write, by name. {@link classifyTool} consults it after the shared table, so a host that
 * names its tools this way needs no declaration and no second list.
 */
export const HOST_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read", "ls", "find", "grep", "glob",
  "memory_search", "memory_get", "sessions_list", "sessions_history", "agents_list",
]);

/**
 * The host tools that dispatch on an `action` argument (and the `*_actions` family). Only these may be cleared by a read-only
 * `action`: it is model-supplied, so honouring it for any other name would let `sessions_send {action:"get"}` pass as a read.
 */
export const ACTION_DISPATCHED_HOST_TOOLS: ReadonlySet<string> = new Set(["process", "cron", "canvas", "gateway", "nodes", "browser"]);

function isActionDispatchedHostTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return ACTION_DISPATCHED_HOST_TOOLS.has(normalized) || normalized.endsWith("_actions");
}

/** `action` values of an action-dispatched host tool (`cron`, `canvas`, `*_actions`) that only read. */
export const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  "get", "list", "read", "status", "show", "fetch", "search", "query", "view", "poll", "log", "inspect", "check", "probe",
]);

/**
 * How a run ends or asks. A class gate (or any gate that names no tool) never withholds or
 * refuses these, so a fully-gated run can still stop and ask; the lowered form of a class
 * gate must not name them either.
 */
export const CONTROL_TOOL_NAMES: readonly string[] = ["finish", "ask_human", "ask_user"];

/**
 * Names an on-prem host emits for tools that write, used ONLY to spell a class gate out per tool for a host that predates
 * `sideEffect` gates (`lowerSideEffectGates`). The compact form needs no list: it fails closed for every unclassified name.
 */
export const HOST_MUTATING_TOOLS: readonly string[] = [
  "write", "edit", "apply_patch", "exec", "bash", "process", "message", "sessions_send", "cron", "gateway", "canvas", "nodes", "session_status",
];
