/**
 * A review as a RUN with an id, a record and a view (PRD 41 A8), as the host sees it: `trackRun`
 * starts the record when a review starts (kind `review` · `re-review` · `seed`), folds the review's
 * progress and steps into it, posts it throttled (`reviewRunRecorder.ts`) and keeps it on disk
 * (`reviewRunStore.ts`): a `running` record at the start, refreshed every {@link RUN_SAVE_INTERVAL_MS}, and the
 * final one with the outcome, the report and the replica queue's state. `listRuns` / `getRun` read the
 * records back.
 *
 * The posted record is bounded: the latest {@link WIRE_FAILURES} failures and the `failureCount`; the whole
 * record, every failure, is what `getRun` returns.
 *
 * Ports only (`post`, `replica`, the `KnowledgeFiles` the snapshots use): no `vscode` here.
 */

import type { ReviewProgress, ReviewReport, ReviewRunOutcome, ReviewStep } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeFiles, ReplicaState } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeRunSummary, KnowledgeStoredRun } from "../knowledgeProtocol";
import { createRunRecorder, newRunId, runKindOf } from "./reviewRunRecorder";
import { createRunStore } from "./reviewRunStore";

/** The failures a posted run carries; the rest are one `runRecord` call away. */
export const WIRE_FAILURES = 50;
/** How often a running record is refreshed on disk. */
export const RUN_SAVE_INTERVAL_MS = 5_000;

/** The runs this process is writing right now: never read back as `interrupted`. */
const liveRuns = new Set<string>();
export const isRunLive = (runId: string): boolean => liveRuns.has(runId);

/** Every run this process is writing, by run id: Stop reaches any of them, whichever entry point started it. */
const runAborts = new Map<string, AbortController>();
/** Aborts a live run by id; false when this process is not running it. */
export function stopRunById(runId: string): boolean {
  const abort = runAborts.get(runId);
  abort?.abort();
  return !!abort;
}

const storeOf = (files: KnowledgeFiles) => createRunStore(files, { isLive: isRunLive });

/** A run as it rides the bridge: bounded failures, their true count. */
export function onTheWire(run: KnowledgeStoredRun): KnowledgeStoredRun {
  const { report, ...rest } = run;
  // The report never rides with its failures: the bounded list is `failures`, the whole one is `getRun`.
  return { ...rest, ...(report ? { report: { ...report, failures: [] } } : {}), failures: run.failures.slice(-WIRE_FAILURES), failureCount: run.failures.length };
}

export interface TrackRunArgs {
  /** The root id being reviewed. */
  rootId: string;
  request: { force?: boolean; seed?: boolean };
  files: KnowledgeFiles;
  /** Aborting it stops the review; registered so {@link stopRunById} reaches the run. */
  abort?: AbortController;
  post(run: KnowledgeStoredRun): void;
  /** Where the replica queue stands (a linked root); undefined when the root is not linked. */
  replica(): Promise<ReplicaState | undefined>;
  /** Why parallel extraction was unavailable (the run extracted on one thread), read when the run is posted or kept. */
  poolDown?: () => string | undefined;
  /** A run record that could not be kept is reported, never a failed review. */
  onSaveError?(error: unknown): void;
}

export interface RunTracker {
  readonly id: string;
  progress(progress: ReviewProgress): void;
  step(step: ReviewStep): void;
  /** Closes the run, keeps it, then posts it. Never rejects. */
  finish(outcome: ReviewRunOutcome, report?: ReviewReport): Promise<void>;
}

export function trackRun(args: TrackRunArgs): RunTracker {
  const store = storeOf(args.files);
  const withPool = (run: KnowledgeStoredRun): KnowledgeStoredRun => {
    const down = args.poolDown?.();
    return down ? { ...run, poolDown: down } : run;
  };
  const recorder = createRunRecorder({ id: newRunId(), root: args.rootId, kind: runKindOf(args.request), post: (run) => args.post(onTheWire(withPool(run))) });
  const id = recorder.run.id;
  liveRuns.add(id);
  if (args.abort) runAborts.set(id, args.abort);
  const keep = (run: KnowledgeStoredRun, opts?: { prune?: boolean }): Promise<void> =>
    store.save(withPool(run), opts).catch((error: unknown) => args.onSaveError?.(error));
  // Interrupted if the window closes now: the record exists from the start and is refreshed while the run goes on.
  void keep(recorder.run);
  const refresh = setInterval(() => void keep({ ...recorder.run, updatedAt: Date.now() }), RUN_SAVE_INTERVAL_MS);

  return {
    id,
    progress: (p) => recorder.progress(p),
    step: (s) => recorder.step(s),
    async finish(outcome, report) {
      clearInterval(refresh);
      try {
        const replica = await args.replica().catch(() => undefined);
        const run = recorder.close(outcome, report, replica);
        await keep(run, { prune: true });
      } finally {
        liveRuns.delete(id);
        runAborts.delete(id);
        recorder.flush();
      }
    },
  };
}

/** A root's recent runs, newest first (light: no steps, lanes or failures; the failure count stays). */
export const listRuns = (files: KnowledgeFiles, rootId: string): Promise<KnowledgeRunSummary[]> => storeOf(files).list(rootId);

/** One whole run, every failure included, looked for in each of the given roots' files; null when none holds it. */
export async function getRun(filesOfRoots: readonly KnowledgeFiles[], runId: string): Promise<KnowledgeStoredRun | null> {
  for (const files of filesOfRoots) {
    const run = await storeOf(files).get(runId);
    if (run) return run;
  }
  return null;
}
