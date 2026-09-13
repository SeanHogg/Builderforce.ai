/**
 * What a settled code-changing run reports to learned routing — so a run in the editor
 * teaches the router the way a cloud run does.
 *
 * Before this, only cloud runs were ever scored: an IDE run changed code, shipped it or
 * failed, and the router never heard. Now a run that changed code reports how its CODER
 * did — the model that made the edits (after an analysis→code hand-off, the coding model;
 * under a pin, the pinned one) — under the `code` role, which is exactly the evidence the
 * gateway reads when it picks the coder for the next run.
 *
 * Field names are the `POST /llm/v1/run-outcome` wire contract (`RunOutcomeRequest` in
 * `@builderforce/learned-routing`); the host owns the transport. Pure.
 */

import type { BrainTraceEvent } from './brainTriage';

export interface BrainRunOutcome {
  /** Idempotency key — one outcome per run. */
  clientRunId: string;
  /** The model that made this run's code changes. */
  model: string;
  role: 'code';
  source: 'ide';
  terminalStatus: 'completed' | 'failed';
  /** The change landed on the base branch (the run's own push). */
  merged: boolean;
  /** Completed model turns — the efficiency half of the score. */
  steps: number;
  projectId?: number;
}

/** A run's idempotency key: one chat runs one run at a time, so chat + start is unique. */
export function runOutcomeId(chatId: number, startedAtMs: number): string {
  return `ide:${chatId}:${startedAtMs}`;
}

/**
 * The outcome to report for a settled run, or null when there is nothing to learn: a
 * user Stop (an interrupted run grades no one), a run that changed no code (no coder was
 * exercised), or one whose coding model is unknown.
 */
export function codeRunOutcome(args: {
  runId: string;
  codeModel: string | null;
  codeChanged: boolean;
  aborted: boolean;
  failed: boolean;
  shipped: boolean;
  /** THIS run's trace — the completed turns are counted from it. */
  trace: readonly BrainTraceEvent[];
  projectId?: number | null;
}): BrainRunOutcome | null {
  if (args.aborted || !args.codeChanged || !args.codeModel || !args.runId) return null;
  return {
    clientRunId: args.runId,
    model: args.codeModel,
    role: 'code',
    source: 'ide',
    terminalStatus: args.failed ? 'failed' : 'completed',
    merged: args.shipped,
    steps: args.trace.filter((e) => e.label === 'llm.complete' && !e.isError).length,
    ...(args.projectId != null ? { projectId: args.projectId } : {}),
  };
}
