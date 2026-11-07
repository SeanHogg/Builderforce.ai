/**
 * The host's recorder of one review run (PRD 41 A8): folds a review's `onProgress`, `onStep` and end
 * into memory's `ReviewRun` (`applyRunEvent`, the ONE reducer) and posts the run to the view,
 * throttled to at most {@link RUN_POST_INTERVAL_MS}-spaced posts (10 a second). The first post is
 * immediate (the panel opens at once) and the final one is always sent, whenever it comes.
 *
 * No `vscode`, no I/O: the clock and timers are the globals a test fakes.
 */

import {
  applyRunEvent, startRun,
  type ReviewProgress, type ReviewReport, type ReviewRun, type ReviewRunKind, type ReviewRunOutcome, type ReviewStep,
} from "@seanhogg/builderforce-memory/knowledge";
import type { ReplicaState } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeStoredRun } from "../knowledgeProtocol";

/** At most 10 posts a second. */
export const RUN_POST_INTERVAL_MS = 100;

/** A stable id for a run: its start time and a random tail (file-name safe). */
export const newRunId = (at: number = Date.now()): string => `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The kind of run a request makes: *Re-review all* forces, *Use the server's copy* seeds. */
export const runKindOf = (r: { force?: boolean; seed?: boolean }): ReviewRunKind => (r.seed ? "seed" : r.force ? "re-review" : "review");

export interface RunRecorder {
  /** The run as folded so far. */
  readonly run: KnowledgeStoredRun;
  progress(progress: ReviewProgress): void;
  step(step: ReviewStep): void;
  /** Closes the run (outcome, report, the replica queue's state) WITHOUT posting it: a host keeps it first, then {@link flush}es. */
  close(outcome: ReviewRunOutcome, report?: ReviewReport, replica?: ReplicaState): KnowledgeStoredRun;
  /** Posts the run as it is now, whatever the throttle says. */
  flush(): void;
}

export interface RunRecorderArgs {
  id: string;
  /** The root id the run reviews. */
  root: string;
  kind: ReviewRunKind;
  post(run: KnowledgeStoredRun): void;
}

export function createRunRecorder(args: RunRecorderArgs): RunRecorder {
  // Memory's own run (plus the replica state): `interrupted` is a word the STORE adds when it reads a record back.
  let run: ReviewRun & { replica?: ReplicaState } = startRun({ id: args.id, root: args.root, kind: args.kind, at: Date.now() });
  let lastPostAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (): void => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    lastPostAt = Date.now();
    args.post(run);
  };
  /** Posts now when the interval has passed, else once at its end (latest state wins). */
  const emit = (): void => {
    if (timer) return;
    const wait = RUN_POST_INTERVAL_MS - (Date.now() - lastPostAt);
    if (wait <= 0) send();
    else timer = setTimeout(send, wait);
  };

  emit();
  return {
    get run() { return run; },
    progress(progress) { run = applyRunEvent(run, { type: "progress", progress }, Date.now()); emit(); },
    step(step) { run = applyRunEvent(run, { type: "step", step }, Date.now()); emit(); },
    close(outcome, report, replica) {
      // Nothing posts the closed run before the host has kept it and flushes. The report never carries the failures: `run.failures` holds the list.
      if (timer) { clearTimeout(timer); timer = undefined; }
      run = { ...applyRunEvent(run, { type: "end", outcome, ...(report ? { report: { ...report, failures: [] } } : {}) }, Date.now()), ...(replica ? { replica } : {}) };
      return run;
    },
    flush: send,
  };
}
