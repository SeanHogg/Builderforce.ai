/**
 * policy/finish/gates.ts — the cloud run's FINISH GATES, ported from
 * `api/src/application/runtime/cloudAgent/finishGates.ts`.
 *
 * What a `finish` must clear before the run may end. Each gate yields a NAMED verdict —
 * the verifier cascade (D1) needs to know not just that a finish was refused but WHY:
 * a red CI or a stub is the model's failure and earns a stronger model; CI still running
 * is nobody's failure and must not.
 *
 * In order, each yielding a block the model reads and corrects (null = ship):
 *   0. the required reviewer verdict (sign-off);
 *   1. the completeness self-review (no code deliverable — once);
 *   2. the changed-file source/config policy (`verifyWrittenFiles`, in `policy/guards`);
 *   3. branch CI (red and pending block up to a cap);
 *   4. honesty (a claimed check that could not have run — once);
 *   5. anti-stub (placeholder code, up to a cap).
 *
 * The API engine's repo/db couplings the original folded in (branch-CI polling, the
 * placeholder scan, the structural completion-claim record, live-child tracking) have
 * no counterpart in this package's PORTS contract, so they arrive as OPTIONAL ports a
 * surface supplies. Absent, that gate is an honest no-op rather than an invented check —
 * the behaviour the port must keep is the DECISION and the counters, which persist
 * across durable ticks in {@link FinishGateState}.
 *
 * No `node:*` imports, no DOM.
 */

import { verifyWrittenFiles } from "../guards/sourcePolicy.js";
import {
  MAX_PLACEHOLDER_FINISH_BLOCKS,
  assertsUnrunVerification,
  hasNoCodeDeliverable,
} from "./finishTools.js";

// ── The contract (mirrored from the source) ──────────────────────────────────

export type RequiredReviewSignoff = { roleKey: string; laneKey?: string };

/** Accept evidence only for the exact accountability slot that caused this run. */
export function matchesRequiredReviewSignoff(
  required: RequiredReviewSignoff | undefined,
  toolName: string,
  args: Record<string, unknown>,
  succeeded: boolean,
): boolean {
  if (!required || !succeeded || toolName !== "builtin_kanban_signoff") return false;
  const roleKey = typeof args.roleKey === "string" ? args.roleKey.trim() : "";
  const laneKey = typeof args.laneKey === "string" ? args.laneKey.trim() : undefined;
  return roleKey === required.roleKey && laneKey === required.laneKey;
}

export function missingReviewVerdictMessage(required: RequiredReviewSignoff): string {
  const lane = required.laneKey ? ` and laneKey='${required.laneKey}'` : "";
  return `Cannot finish this reviewer assignment until you call builtin_kanban_signoff with roleKey='${required.roleKey}'${lane} and an explicit approved or changes_requested verdict. A narrative summary is not acceptance evidence.`;
}

/** The gate counters a run carries. `ciVerified` / `finishBlockedOnce` are per tick, as they always were. */
export interface FinishGateState {
  noDeliverableBlocked: boolean;
  reviewVerdictRecorded: boolean;
  placeholderBlocks: number;
  ciPendingBlocks: number;
  ciFailureBlocks: number;
  ciVerified: boolean;
  finishBlockedOnce: boolean;
}

/** The persisted half of {@link FinishGateState} (fields of `CloudLoopState`). */
export type FinishGateSnapshot = Pick<
  FinishGateState,
  "noDeliverableBlocked" | "reviewVerdictRecorded" | "placeholderBlocks" | "ciPendingBlocks" | "ciFailureBlocks"
>;

/** Resume the counters, or start them. A sub-agent's deliverable gate starts spent: its
 *  OWNER is held to it for the whole tree. */
export function initialFinishGateState(resume: Partial<FinishGateSnapshot> | undefined, isChild: boolean): FinishGateState {
  return {
    noDeliverableBlocked: resume?.noDeliverableBlocked ?? isChild,
    reviewVerdictRecorded: resume?.reviewVerdictRecorded ?? false,
    placeholderBlocks: resume?.placeholderBlocks ?? 0,
    ciPendingBlocks: resume?.ciPendingBlocks ?? 0,
    ciFailureBlocks: resume?.ciFailureBlocks ?? 0,
    ciVerified: false,
    finishBlockedOnce: false,
  };
}

export function finishGateSnapshot(g: FinishGateState): FinishGateSnapshot {
  return {
    noDeliverableBlocked: g.noDeliverableBlocked,
    reviewVerdictRecorded: g.reviewVerdictRecorded,
    placeholderBlocks: g.placeholderBlocks,
    ciPendingBlocks: g.ciPendingBlocks,
    ciFailureBlocks: g.ciFailureBlocks,
  };
}

export type FinishBlockReason =
  | "children_running" | "review_verdict_missing" | "no_deliverable" | "source_quality"
  | "branch_ci" | "branch_ci_pending" | "honesty" | "placeholders" | "claim_evidence";

export interface FinishGateVerdict {
  block: string | null;
  reason?: FinishBlockReason;
}

/** Blocks that are not the MODEL's failure — waiting on CI, or on its own children. */
export function isInconclusiveFinishBlock(reason: FinishBlockReason | undefined): boolean {
  return reason === "branch_ci_pending" || reason === "children_running";
}

// ── The optional engine ports (a surface supplies what it can) ───────────────

/** A branch CI status, as `pollCommitCiStatus.ciFinishDecision` produces it. */
export interface CiFinishDecision {
  block: string | null;
  ciVerified: boolean;
  pendingBlocks: number;
  failureBlocks: number;
}

/** A placeholder scan result, as `scanForPlaceholders` produces it. */
export interface PlaceholderScan {
  flagged: Array<{ path: string; markers: string[] }>;
}

export interface FinishGatePorts {
  /** Read a written file's committed content (enables the source/config policy). */
  read?: (path: string) => Promise<string | null>;
  /** Poll the branch's CI and decide whether it blocks finish. */
  pollBranchCi?: () => Promise<CiFinishDecision>;
  /** Scan the written files for placeholder/stub code. */
  scanPlaceholders?: (paths: readonly string[]) => Promise<PlaceholderScan>;
}

export interface FinishGateArgs {
  /** The files the run wrote (empty ⇒ no deliverable / nothing to verify). */
  writtenPaths: readonly string[];
  requiredSignoff: RequiredReviewSignoff | undefined;
  /** The run is a node of a delegation tree (unused here: the engine owns child tracking). */
  delegated: boolean;
  summary: string;
  output: string;
  gates: FinishGateState;
  /** The run just performed its verification action: move the policy into `verify`. */
  enterVerify: () => void;
  /** The optional engine couplings a surface supplies. */
  ports?: FinishGatePorts;
}

/** Run every gate; the first that blocks wins. Validation is AUTOMATIC: a model that
 *  rushes straight to `finish` cannot skip it. */
export async function evaluateFinishGates(a: FinishGateArgs): Promise<FinishGateVerdict> {
  const { writtenPaths, requiredSignoff, summary, gates } = a;
  const wrote = writtenPaths.length > 0;
  const verification = a.ports?.read && wrote
    ? await verifyWrittenFiles(a.ports.read, writtenPaths)
    : null;
  // Branch CI is polled once static validation is clean; its decision is applied in
  // order below so a green/none result still falls through to honesty + anti-stub.
  let ci: CiFinishDecision | null = null;
  let ciPending = false;
  if (a.ports?.pollBranchCi && wrote && verification?.ok !== false) {
    ci = await a.ports.pollBranchCi();
    // A pending block is the one that spent a pending allowance.
    ciPending = ci.pendingBlocks > gates.ciPendingBlocks;
    gates.ciPendingBlocks = ci.pendingBlocks;
    gates.ciFailureBlocks = ci.failureBlocks;
    if (ci.ciVerified) gates.ciVerified = true;
  }
  // The run has just PERFORMED its verification action, so every turn a block below
  // forces is asked as `verify`. Idempotent, so a second blocked finish is a no-op.
  if (wrote) a.enterVerify();

  if (requiredSignoff && !gates.reviewVerdictRecorded) {
    const block = missingReviewVerdictMessage(requiredSignoff);
    return { block, reason: "review_verdict_missing" };
  }
  if (wrote && !gates.noDeliverableBlocked && hasNoCodeDeliverable(writtenPaths)) {
    // A code-bound run is finishing with NO code deliverable: block ONCE and make it
    // self-review the requirements. A legitimate no-op run finishes on the retry.
    gates.noDeliverableBlocked = true;
    return {
      block:
        "Before finishing: you have not committed any code changes for this task — only the PRD (or nothing) is on the branch. Re-read the task requirements and verify EACH is actually implemented. If work remains, use search_code/read_file to find the right place and write_file to implement it, then finish. If — and only if — this task genuinely requires no code change, call finish again and state explicitly why no change was needed.",
      reason: "no_deliverable",
    };
  }
  if (verification && !verification.ok) {
    return {
      block:
        `Cannot finish — changed-file validation found ${verification.errors.length} issue(s). ` +
        "Repair every issue, then finish again. This is a shell-free source policy, not a claim that the full project type-check ran.\n" +
        verification.errors.map((e) => `- ${e.path}${e.line ? `:${e.line}` : ""}${e.ruleId ? ` [${e.ruleId}]` : ""}: ${e.message}`).join("\n"),
      reason: "source_quality",
    };
  }
  if (ci?.block) {
    const v: FinishGateVerdict = { block: ci.block, reason: "branch_ci" };
    return ciPending ? { ...v, reason: "branch_ci_pending" } : v;
  }
  if (summary && !gates.finishBlockedOnce && !gates.ciVerified && assertsUnrunVerification(summary)) {
    // The summary claims a check passed, but nothing was (or could be) run. Block once.
    gates.finishBlockedOnce = true;
    return {
      block: "You stated that a build/type-check/lint/test passed or is resolved, but this executor cannot run a local shell and in-run CI did not report success. Call run_checks (it polls branch CI) or finish again with a summary that does NOT claim a check passed.",
      reason: "honesty",
    };
  }
  if (wrote && gates.placeholderBlocks < MAX_PLACEHOLDER_FINISH_BLOCKS && a.ports?.scanPlaceholders) {
    // Refuse to ship placeholder/scaffold code: implement it for real or delete it.
    const scan = await a.ports.scanPlaceholders(writtenPaths);
    if (scan.flagged.length) {
      gates.placeholderBlocks += 1;
      return {
        block:
          `Cannot finish — ${scan.flagged.length} committed file(s) still contain placeholder/stub code instead of a real implementation. ` +
          "Replace each stub with a working implementation that uses the existing infrastructure (search_code for it first), or if a file is dead code that should not ship in this PR, remove it with delete_file. Then call finish again.\n" +
          scan.flagged.map((f) => `- ${f.path}: ${f.markers.join("; ")}`).join("\n"),
        reason: "placeholders",
      };
    }
  }
  return { block: null };
}
