/**
 * Run-host adapter for the G19 change-set library.
 *
 * `captureRunChangeBaseline` and `finalizeRunChangeSets` read git and the
 * filesystem. A unit test cannot call them without editing `runChangeSets.ts`
 * or shelling out, so this adapter takes a baseline/finalize port instead.
 * Attribution and the immutable record id still come from the library exports
 * that do not need git: `attributeRunChanges` and `runChangeSetId`.
 *
 * A file whose hash did not move is not claimed. A retried finalization
 * returns the stored record and does not write a second one.
 *
 * Not imported by the run host (`brainRunHostPorts.ts` / `extension.ts`).
 * A host start still does not go through this recorder.
 */

import { normalizePath } from "./gitChangeModel";
import {
  attributeRunChanges,
  runChangeSetId,
  type AttributedChange,
  type FileFingerprint,
  type RunChangeBaseline,
} from "./runChangeSets";

/** One pending file the port already hashed. The adapter does not read the file or git. */
export interface CurrentFileReading {
  root: string;
  relativePath: string;
  status: string;
  hash: FileFingerprint;
  repository?: string;
  branch?: string;
  baseCommit?: string;
}

/** Immutable record this adapter commits. Identity is `runChangeSetId`. */
export interface RecordedChangeSet {
  id: string;
  runId: string;
  root: string;
  repository: string;
  branch?: string;
  baseCommit?: string;
  capturedAt: string;
  files: AttributedChange[];
}

/**
 * What a host (or a test) supplies so the adapter never shells out to git.
 * `baseline` is the start snapshot; `current` / `read` / `write` are the
 * finalize side. `write` is the only store mutation, and the adapter calls
 * it at most once per record id.
 */
export interface BaselineFinalizePort {
  baseline(): Promise<RunChangeBaseline>;
  current(): Promise<CurrentFileReading[]>;
  read(id: string): Promise<RecordedChangeSet | undefined>;
  write(record: RecordedChangeSet): Promise<void>;
}

/**
 * Capture a baseline, run, then finalize. Evidence never fails the run.
 * A baseline that cannot be read skips finalization — without it every
 * pre-existing dirty file would be claimed as run-authored.
 */
export async function recordRunChangeSet<T>(
  args: { runId: string; port: BaselineFinalizePort; now?: () => Date },
  run: () => Promise<T>,
): Promise<T> {
  let baseline: RunChangeBaseline | undefined;
  try {
    baseline = await args.port.baseline();
  } catch {
    baseline = undefined;
  }
  try {
    return await run();
  } finally {
    if (baseline) {
      try {
        await finalizeRecordedChangeSet({
          runId: args.runId,
          baseline,
          port: args.port,
          ...(args.now ? { now: args.now } : {}),
        });
      } catch {
        // A missing change-set must not fail the run.
      }
    }
  }
}

/**
 * Close one run's evidence against a port-supplied working tree.
 * Unmoved hashes are dropped by `attributeRunChanges`. An id that is already
 * stored is returned as-is — `write` is not called again.
 */
export async function finalizeRecordedChangeSet(args: {
  runId: string;
  baseline: RunChangeBaseline;
  port: BaselineFinalizePort;
  now?: () => Date;
}): Promise<RecordedChangeSet[]> {
  const at = (args.now?.() ?? new Date()).toISOString();
  const current = await args.port.current();
  const baselineByRoot = new Map(args.baseline.repos.map((repo) => [normalizePath(repo.root), repo]));

  const byRoot = new Map<string, CurrentFileReading[]>();
  for (const file of current) {
    const key = normalizePath(file.root);
    const list = byRoot.get(key);
    if (list) list.push(file);
    else byRoot.set(key, [file]);
  }

  const committed: RecordedChangeSet[] = [];
  for (const [rootKey, files] of byRoot) {
    const sample = files[0];
    if (!sample) continue;
    const baselineRepo = baselineByRoot.get(rootKey);
    const changes = attributeRunChanges(
      baselineRepo?.files ?? {},
      files.map((file) => ({
        relativePath: file.relativePath,
        status: file.status,
        hash: file.hash,
      })),
    );
    if (!changes.length) continue;

    const id = runChangeSetId(args.runId, sample.root);
    const existing = await args.port.read(id);
    if (existing) {
      committed.push(existing);
      continue;
    }

    const branch = sample.branch ?? baselineRepo?.branch;
    const baseCommit = baselineRepo?.baseCommit ?? sample.baseCommit;
    const record: RecordedChangeSet = {
      id,
      runId: args.runId,
      root: sample.root,
      repository: baselineRepo?.repository ?? sample.repository ?? sample.root,
      ...(branch ? { branch } : {}),
      ...(baseCommit ? { baseCommit } : {}),
      capturedAt: at,
      files: changes,
    };
    await args.port.write(record);
    committed.push(record);
  }
  return committed;
}
