/**
 * One repository's git labels as a pure batch (PRD 41 §D1): every pending run over the repository's ONE shared history
 * (`outcomeGit.laterHistory`), each run seeing only the commits after its own run end. Pure; runs in the label worker
 * (`labelWorker.ts`), or in this thread when no worker bundle exists (tests, a dev run before the bundle).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { labelFollowupFix, labelReverted, type HistoryCommit, type RunCommits, type RunOutcomeLabel } from "@builderforce/run-delta/predict";

export interface LabelBatch {
  runs: Array<{ id: string; run: RunCommits }>;
  /** The repository's commits since the oldest pending run end, oldest first. */
  history: HistoryCommit[];
  now: string;
}

/** Record id → its `followup-fix` and `reverted` labels at `now`. */
export function labelBatch(batch: LabelBatch): Array<{ id: string; labels: RunOutcomeLabel[] }> {
  return batch.runs.map(({ id, run }) => {
    const history = batch.history.filter((c) => Date.parse(c.at) >= Date.parse(run.finalizedAt));
    return { id, labels: [labelFollowupFix({ run, history, now: batch.now }), labelReverted({ run, history, now: batch.now })] };
  });
}

/** The bundle entry esbuild writes beside `out/extension.js`. */
export const OUTCOME_WORKER_FILE = "runOutcomeWorker.js";

/** {@link labelBatch} in a worker when the bundle has one; the worker is terminated after its one answer. */
export function labelBatchOffThread(batch: LabelBatch): Promise<Array<{ id: string; labels: RunOutcomeLabel[] }>> {
  const file = path.join(__dirname, OUTCOME_WORKER_FILE);
  if (!fs.existsSync(file)) return Promise.resolve(labelBatch(batch));
  return new Promise((resolve, reject) => {
    const worker = new Worker(file);
    const done = (): void => { void worker.terminate(); };
    worker.once("message", (reply: { ok: true; labels: Array<{ id: string; labels: RunOutcomeLabel[] }> } | { ok: false; error: string }) => {
      done();
      if (reply.ok) resolve(reply.labels);
      else reject(new Error(reply.error));
    });
    worker.once("error", (error) => { done(); reject(error); });
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`run_outcome_worker_exit:${code}`)); });
    worker.postMessage(batch);
  });
}
