/**
 * What a DELEGATION call's result says its children did — THE reader of that shape, and
 * THE set of calls that delegate.
 *
 * A parent whose sub-agents do the writing never names a file in its own call's args:
 * `wait_agents` (and `spawn_agent` / `spawn_agents` when they complete in the call, and
 * `hand_off` when it carries them) return the files the children changed in the RESULT's
 * `changedFiles`, and the reports they filed in `reports`. Read only from the args, a pure
 * orchestrator never wrote anything, never earned verified work, and every idle-shaped
 * trip climbed the whole ladder (VS Code chat #157440).
 *
 * Only a delegation's result is read ({@link DELEGATION_TOOLS}): any other tool that
 * happens to return a `changedFiles` field earns no credit. Pure. Whether the call
 * SUCCEEDED is the caller's judgement, not this reader's.
 */

import { SPAWN_AGENTS_TOOL, SUBAGENT_CONTROL_TOOL_NAMES, type ChildReportLike } from "@builderforce/agent-tools";
import { JOB_POLL_TOOLS } from "./noProgress.js";

/**
 * The tools a run delegates through — one child, or several side by side; each result
 * carries the files its children changed. `hand_off` is one too (brain-embedded's
 * `HAND_OFF_TOOL`: a plan handed to parallel coding children reports their files), and
 * `wait_agents` is where an owner COLLECTS its background children's reports.
 */
export const DELEGATION_TOOLS: ReadonlySet<string> = new Set<string>(["spawn_agent", SPAWN_AGENTS_TOOL, SUBAGENT_CONTROL_TOOL_NAMES.wait, "hand_off"]);

/** Whether a call delegates work to sub-agents ({@link DELEGATION_TOOLS}). */
export function isDelegationTool(tool: string): boolean {
  return DELEGATION_TOOLS.has(tool);
}

/**
 * The calls that WAIT on work running elsewhere — `wait_agents` on the run's children, and
 * the background-job polls (`command_status` / `command_stop`). Repeating one while the
 * children or the job are still running is waiting, not a loop (chat #157440).
 */
export const WAIT_POLL_TOOLS: ReadonlySet<string> = new Set<string>([SUBAGENT_CONTROL_TOOL_NAMES.wait, ...JOB_POLL_TOOLS]);

/** Whether a call waits on children or a background job ({@link WAIT_POLL_TOOLS}). */
export function isWaitPollTool(tool: string): boolean {
  return WAIT_POLL_TOOLS.has(tool);
}

function recordOf(result: unknown): Record<string, unknown> | null {
  return result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
}

/**
 * A wait whose answer says the work is STILL RUNNING elsewhere — children still `running`,
 * or a background job whose `status` is `running`. That turn is waiting: neither idle nor a
 * read. A wait that returns `running: []` (or a finished job) is not exempt — a real loop must
 * still show.
 */
export function isStillWaiting(tool: string, result: unknown): boolean {
  return waitDigestOf(tool, result) !== null;
}

/**
 * What a still-running wait is waiting ON, as a small digest — the sorted running handles, or
 * a job's id and status — so a ceiling can tell a wait that is moving from one stuck on the
 * same state (`waitCeiling.ts`). Null when the call is not a still-running wait.
 */
export function waitDigestOf(tool: string, result: unknown): string | null {
  if (!isWaitPollTool(tool)) return null;
  const r = recordOf(result);
  if (!r) return null;
  if (Array.isArray(r.running) && r.running.length > 0) {
    return `${tool}:${r.running.map((h) => String(h)).sort().join(",")}`;
  }
  if (r.status === "running") return `${tool}:${typeof r.id === "string" ? r.id : ""}:running`;
  return null;
}

/** A list of paths: strings only, trimmed, deduplicated. */
function pathsOf(files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  const paths = files.filter((f): f is string => typeof f === "string").map((f) => f.trim()).filter((f) => f.length > 0);
  return [...new Set(paths)];
}

/** The files a delegation's result reports its children changed. Empty for any other tool. */
export function delegatedChangedPathsOf(tool: string, result: unknown): string[] {
  return isDelegationTool(tool) ? pathsOf(recordOf(result)?.changedFiles) : [];
}

/** A child report that moved the work: it finished (`done`) or changed files. A failed or stopped child with nothing changed did not. */
function reportMovedWork(report: unknown): boolean {
  const r = recordOf(report);
  return !!r && (r.state === "done" || pathsOf(r.changedFiles).length > 0);
}

/** Whether a delegation's result carries at least one child report that moved the work. False for any other tool. */
export function delegationReportedOf(tool: string, result: unknown): boolean {
  if (!isDelegationTool(tool)) return false;
  const reports = recordOf(result)?.reports;
  return Array.isArray(reports) && reports.some(reportMovedWork);
}

/**
 * A child's report as the owner's host takes it in OUTSIDE a tool result — the default path,
 * where it arrives as a message (`childReportText`). The same reading as a `wait_agents`
 * result: its files are the owner's writes, and a finished report is progress.
 */
export function childReportProgressOf(report: Pick<ChildReportLike, "state" | "changedFiles">): { changedPaths: string[]; moved: boolean } {
  return { changedPaths: pathsOf(report.changedFiles), moved: reportMovedWork(report) };
}
