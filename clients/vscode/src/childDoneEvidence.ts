/**
 * A child's `done` requires EVIDENCE (chat #80006, R2).
 *
 * A child run that reports "done" but changed nothing real, whose last check failed
 * after its final edit, or whose final turn asked an unanswered question / stalled
 * on a promise, is NOT done — it is `incomplete`. Today `childRunSpawner.reportOf`
 * marks any child with a non-empty final reply "done", so a child whose only reply
 * claims completion is taken at its word and the owner builds on nothing.
 *
 * Pure over the run's own record: the settled flag, the snapshot error, the final
 * model reply, the real changed files, and the run's trace (for the failed-check
 * look-back). The stall / permission-menu predicates are the shared ones from
 * `@builderforce/agent-stall` and the progress wording from `@builderforce/run-guards` —
 * this module invents no new text-detection family of its own.
 */

import {
  stallExhaustedNotice,
  stallShape,
  type StallShape,
} from "@builderforce/agent-stall";
import { parseSubagentReport, serializeAskUser } from "@builderforce/agent-loop";
import { claimsReady, progressPauseQuestion } from "@builderforce/run-guards";

/** One row of the run trace, as the host's `getRunTrace` exposes it. */
export interface ChildEvidenceStep {
  category: string;
  label: string;
  args?: unknown;
  result?: unknown;
}

export interface ChildSettledInput {
  /** The child was stop-requested (`stop_agent`). */
  stopped: boolean;
  /** The settled run's error, when it died with one. */
  snapshotError?: string;
  /** The final model reply's text ("" when none). */
  answer: string;
  /** The real changed files — scratch/note files already filtered out. */
  changedFiles: readonly string[];
  /** The run's trace, oldest first — read for the failed-check-after-last-edit look-back. */
  trace?: readonly ChildEvidenceStep[];
  /**
   * The model role the child ran as. Only a `code` child (or one whose role is unknown)
   * must show a real changed file: a review / explore / plan / verify child's deliverable
   * IS its report.
   */
  role?: string;
}

export interface ChildSettledVerdict {
  state: "done" | "failed" | "incomplete" | "stopped";
  /** WHY the child is not done — shown to the owner when present. */
  reason?: string;
}

/** A scratch / probe / note basename is never evidence of real work. */
const SCRATCH_BASENAME = /^__|^__note|^__probe|^__envprobe/;

/** Changed files that count as real evidence — scratch and probe files removed. */
export function realChangedFiles(changedFiles: readonly string[]): string[] {
  return changedFiles.filter((f) => !SCRATCH_BASENAME.test(baseName(f)));
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/** The shape of a run_command result this look-back reads (`ok:false`). */
interface RunCommandOutcome {
  ok?: unknown;
}

function isFailingCheck(step: ChildEvidenceStep): boolean {
  if (step.category !== "tool" || step.label !== "run_command") return false;
  const result = step.result as RunCommandOutcome | string | undefined;
  if (result && typeof result === "object") return result.ok === false;
  if (typeof result === "string") {
    try {
      return (JSON.parse(result) as RunCommandOutcome).ok === false;
    } catch {
      return false;
    }
  }
  return false;
}

function isWriteStep(step: ChildEvidenceStep): boolean {
  return (
    step.category === "tool" &&
    ["edit_file", "write_file", "delete_file"].includes(step.label)
  );
}

/**
 * A check the run COMMANDED (`run_command`) that came back `ok:false` AFTER the last
 * code-change step: the child edited, then its verification failed, then it stopped.
 * That run is not done no matter what its final reply claims.
 */
export function lastEditFailedCheck(trace: readonly ChildEvidenceStep[]): boolean {
  let lastEdit = -1;
  for (let i = 0; i < trace.length; i += 1) if (isWriteStep(trace[i])) lastEdit = i;
  if (lastEdit === -1) return false;
  return trace.slice(lastEdit + 1).some(isFailingCheck);
}

/**
 * The settled state a child EARNS, in priority order:
 * stopped → failed (died or no answer) → incomplete (no real change, failed final
 * check, ended on an unanswered question, or stalled) → done.
 */
export function childSettledState(input: ChildSettledInput): ChildSettledVerdict {
  if (input.stopped) return { state: "stopped" };
  if (input.snapshotError || !input.answer) {
    return { state: "failed", reason: input.snapshotError || "it stopped without a report" };
  }
  const unfinished = unfinishedReportReason(input.answer);
  if (unfinished) return { state: "incomplete", reason: unfinished };
  if (input.changedFiles.length === 0 && mustChangeFiles(input.role)) {
    return {
      state: "incomplete",
      reason: "it reported done but changed no real file (only scratch/note files)",
    };
  }
  if (lastEditFailedCheck(input.trace ?? [])) {
    return {
      state: "incomplete",
      reason: "a check it ran (run_command) failed after its last edit — the change is unverified",
    };
  }
  const shape = finalTurnStall(input.answer);
  if (shape) {
    return {
      state: "incomplete",
      reason: `its final turn ${stallExhaustedNotice(undefined, undefined, shape)}`,
    };
  }
  if (isUnansweredQuestion(input.answer)) {
    return { state: "incomplete", reason: "it ended on an unanswered question" };
  }
  return { state: "done" };
}

/** A role whose deliverable is a change: `code`, or a child whose role the host does not know. */
function mustChangeFiles(role: string | undefined): boolean {
  return role === undefined || role === "code";
}

/** The fence tag of the shared question protocol (agent-loop `serializeAskUser`) — derived, never re-spelled. */
const ASK_USER_FENCE_TAG = serializeAskUser({ question: "", options: [], multiSelect: false }).split("\n")[0]!;

/** Own words at or above this length are a deliverable, whatever their first sentence claims. */
const REPORT_MIN_CHARS = 800;

/**
 * Why a child's final reply is NOT its report, or null when it is one (VS Code chat #273):
 *   - it carries an ask-user block — a sub-agent has no person to answer it, so the run
 *     settled on a question nobody will see;
 *   - it claims readiness ("I have enough to produce the report…", `claimsReady`) and then
 *     delivers nothing — no `Outcome:` line of the report contract (`parseSubagentReport`)
 *     and too little prose to be the report itself.
 * The host gives such a child ONE more turn ({@link REPORT_NOW_STEER}) before settling it.
 */
export function unfinishedReportReason(answer: string): string | null {
  const text = answer.trim();
  if (!text) return null;
  // The fence itself — never a comparison with `stripAskUser`'s output, which also collapses blank lines.
  if (text.includes(ASK_USER_FENCE_TAG)) {
    return "it ended by asking the user a question (an ask-user block) instead of reporting — a sub-agent has no person to answer it";
  }
  if (claimsReady(text) && !parseSubagentReport(text).outcome && text.length < REPORT_MIN_CHARS) {
    return "it said it had enough to write its report, then ended without writing it";
  }
  return null;
}

/** The one extra turn a child whose final reply was not its report is steered with. */
export const REPORT_NOW_STEER =
  "You cannot ask the user anything, and your owner only reads your final message. Write your report NOW from what you already have — do not make more calls. " +
  "State your coverage: every file and window you read and every list/search call with its offsets, and say plainly what you did NOT cover. End with the report lines.";

/**
 * Did the final turn stall — offer a permission menu / hand off / announce work it
 * never did, with zero tool calls on that turn? Reuses `@builderforce/agent-stall`'s
 * `stallShape` predicate; the final-turn facts say it made no tool call on that turn
 * and every recovery is spent, so an exhausted stall is what the owner inherits.
 */
function finalTurnStall(answer: string): StallShape | null {
  return stallShape({
    text: answer,
    toolCallCount: 0,
    availableToolCount: 1,
    recoveriesUsed: Number.MAX_SAFE_INTEGER,
  });
}

/** The progress wording shared with the run's own progress detector (PRD A3). */
const NO_PROGRESS_QUESTION = progressPauseQuestion({ kind: "no_progress" }, 1);

/**
 * A final turn that is PURELY a question — the ask_user shape typed into prose, or the
 * detector's own no-progress pause question — is an unanswered question, not an answer.
 * Permission-menu offers are caught by the stall shape above first, so only a bare
 * question reaches here.
 */
function isUnansweredQuestion(answer: string): boolean {
  const t = answer.trim();
  if (!t) return false;
  if (t === NO_PROGRESS_QUESTION) return true;
  return /[?]\s*$/.test(t) && t.replace(/\s+/g, " ").split(" ").length <= 60;
}
