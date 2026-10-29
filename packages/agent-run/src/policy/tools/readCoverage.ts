/**
 * policy/tools/readCoverage — the agent's binding of the shared read guard
 * (`@builderforce/run-guards` `ReadCoverage`, WS8a), on every entry point (§6.10).
 *
 * The rules — exact repeat, covered window, and the one `invalidate` that decides what a
 * non-read call forgets — live once in run-guards. What is the agent's own is its tool
 * VOCABULARY ({@link AGENT_READ_TRAITS}), and where the record lives: `RunState.reads.served`,
 * one entry per read the model was SERVED (the post-cap result), so a resumed tick and a
 * compacted transcript keep the same coverage a continuous run holds.
 *
 *   • {@link coveredReadAnswer} (before dispatch) answers an exact repeat, or a
 *     `read_file` window inside one already served: a stub while the serving row is
 *     still in the transcript, a REPLAY of the requested window from the served copy once
 *     compaction dropped it. A jump to unserved lines still runs.
 *   • {@link recordServedRead} (after dispatch) records a successful read, or forgets
 *     exactly what a non-read call could have changed.
 *
 * No `node:*` imports, no DOM.
 */

import { ReadCoverage, canonicalReadArgs, type CachedRead, type CoveredRead, type ReadCoverageTraits } from "@builderforce/run-guards";
import { isReadFileResult, sliceReadFile } from "@builderforce/tool-output-policy";
import type { RunState } from "../../contract.js";
import type { PolicyContext, PolicyToolCall } from "../hooks.js";

/** The reads the guard answers from coverage. */
const DEDUPABLE_READS: ReadonlySet<string> = new Set(["read_file", "list_files", "search_code", "find_symbol", "file_outline"]);
/** Calls that may change any file, unnamed. */
const UNSCOPED_MUTATIONS: ReadonlySet<string> = new Set(["run_command", "git_checkout", "git_merge", "git_rebase", "git_reset", "git_stash", "git_pull", "apply_patch"]);
/** File writes / edits / deletes. */
const CODE_CHANGES: ReadonlySet<string> = new Set(["write_file", "edit_file", "delete_file", "create_file", "move_file"]);
/** Local tools that publish work. */
const PUBLISHES: ReadonlySet<string> = new Set(["git_commit", "git_push", "create_pull_request"]);
/** Reads of repository state a publish moves. */
const REPO_STATE_READS: ReadonlySet<string> = new Set(["git_status", "git_log", "git_branch"]);

const SEPARATOR = " ∋ ";

function pathOf(args: unknown): string | undefined {
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const path = typeof a.path === "string" ? a.path : typeof a.scope === "string" ? a.scope : undefined;
  return path?.trim() || undefined;
}

/** The agent's tool vocabulary, as the shared read guard asks for it. */
export const AGENT_READ_TRAITS: ReadCoverageTraits = {
  visitTarget: (args) => {
    const path = pathOf(args) ?? "";
    const query = args && typeof args === "object" ? (args as { query?: unknown }).query : undefined;
    return typeof query === "string" && query.trim() ? `${path}${SEPARATOR}${query.trim()}` : path || undefined;
  },
  activityTarget: pathOf,
  questionSeparator: SEPARATOR,
  isUnscopedMutation: (tool) => UNSCOPED_MUTATIONS.has(tool),
  isCodeChangeTool: (tool) => CODE_CHANGES.has(tool),
  isLocalWorkspaceTool: (tool) =>
    DEDUPABLE_READS.has(tool) || CODE_CHANGES.has(tool) || UNSCOPED_MUTATIONS.has(tool) || tool.startsWith("git_"),
  isRepoPublishTool: (tool) => PUBLISHES.has(tool),
  isRepoStateReadTool: (tool) => REPO_STATE_READS.has(tool),
};

/** A served read's key in `RunState.reads.served`: the tool and its canonical arguments. */
function servedKey(tool: string, args: unknown): string {
  return `${tool}\u0000${JSON.stringify(canonicalReadArgs(tool, args))}`;
}

function parseKey(key: string): { tool: string; args: Record<string, unknown> } | null {
  const at = key.indexOf("\u0000");
  if (at < 0) return null;
  try {
    return { tool: key.slice(0, at), args: JSON.parse(key.slice(at + 1)) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Per-state guards, rebuilt from `RunState.reads.served` the first time a state is seen. */
const sessions = new WeakMap<RunState, ReadCoverage>();

function coverageOf(state: RunState): ReadCoverage {
  let coverage = sessions.get(state);
  if (coverage) return coverage;
  coverage = new ReadCoverage(AGENT_READ_TRAITS);
  for (const [key, entry] of Object.entries(state.reads.served)) {
    const read = parseKey(key);
    if (!read) continue;
    coverage.record(read.tool, read.args);
    if (entry.cached) coverage.cacheResult(read.tool, read.args, entry.cached);
  }
  sessions.set(state, coverage);
  return coverage;
}

/** Is the row that served `anchor` (a tool-call id) still in the working transcript? */
function stillServed(ctx: PolicyContext, anchor: unknown): boolean {
  return ctx.messages.some((m) => m.role === "tool" && m.toolCallId === anchor);
}

/**
 * Before dispatch: the answer for a read the model was already served, or nothing to let
 * the call run.
 */
export function coveredReadAnswer(ctx: PolicyContext, call: PolicyToolCall): { data: unknown } | undefined {
  if (!DEDUPABLE_READS.has(call.name)) return undefined;
  const answer = coveredAnswer(ctx, call);
  if (answer) ctx.state.reads = { ...ctx.state.reads, stubCount: (ctx.state.reads.stubCount ?? 0) + 1 };
  return answer;
}

function coveredAnswer(ctx: PolicyContext, call: PolicyToolCall): { data: unknown } | undefined {
  const coverage = coverageOf(ctx.state);
  if (coverage.isRepeat(call.name, call.args)) {
    const cached = coverage.cachedResult(call.name, call.args);
    if (cached && !stillServed(ctx, cached.anchor)) {
      const note = `Replayed from this run's read cache: this exact ${call.name} call succeeded earlier in the run, but its result was compressed out of the working context, so here it is again — served from memory, not re-read. Act on it now; do not request it again.`;
      return { data: withNote(cached.served ?? cached.result, note) };
    }
    return {
      data: {
        note: `Duplicate ${call.name} call — identical arguments to an earlier call this run, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it.`,
      },
    };
  }
  const covered = coverage.coveredRead(call.name, call.args);
  if (!covered) return undefined;
  coverage.record(call.name, call.args);
  if (covered.cached && !stillServed(ctx, covered.cached.anchor)) {
    const served = covered.cached.served ?? covered.cached.result;
    // The REQUESTED window, cut from the covering read — not that read's own window (E1).
    const requested = isReadFileResult(served) ? sliceReadFile(served, covered.start, covered.end) : served;
    return { data: withNote(requested, covered.note) };
  }
  return { data: { note: covered.note } };
}

function withNote(result: unknown, note: string): unknown {
  return result && typeof result === "object" && !Array.isArray(result) ? { ...(result as Record<string, unknown>), note } : { output: result, note };
}

/** The lines a `read_file` result served (1-based, inclusive); a non-file read spans nothing. */
function servedSpan(served: unknown): { start: number; end: number } {
  if (!isReadFileResult(served)) return { start: 0, end: 0 };
  const start = typeof served.offset === "number" && served.offset > 0 ? Math.floor(served.offset) : 1;
  return { start, end: start + served.content.split("\n").length - 1 };
}

function failed(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
}

/**
 * After dispatch: record what the model was SERVED (the capped result), or forget what a
 * non-read call could have changed — in the guard and in `RunState.reads.served`.
 */
export function recordServedRead(ctx: PolicyContext, call: PolicyToolCall, served: unknown, isError: boolean): void {
  const coverage = coverageOf(ctx.state);
  const reads = ctx.state.reads;
  if (DEDUPABLE_READS.has(call.name)) {
    if (isError || failed(served)) return;
    coverage.record(call.name, call.args);
    const cached: CachedRead = { result: served, served, anchor: call.id };
    coverage.cacheResult(call.name, call.args, cached);
    const entry: CoveredRead = { ...servedSpan(served), cached, note: "" };
    ctx.state.reads = { ...reads, served: { ...reads.served, [servedKey(call.name, call.args)]: entry } };
    return;
  }
  coverage.invalidate(call.name, call.args);
  const kept: Record<string, CoveredRead> = {};
  for (const [key, entry] of Object.entries(reads.served)) {
    const read = parseKey(key);
    if (read && coverage.isRepeat(read.tool, read.args)) kept[key] = entry;
  }
  ctx.state.reads = { ...reads, served: kept };
}
