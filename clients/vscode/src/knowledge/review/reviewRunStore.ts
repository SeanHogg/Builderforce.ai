/**
 * A root's review runs on disk (PRD 41 A8): `.builderforce/knowledge/runs/<runId>.json`, one file per run,
 * plus a per-root index (`runs/<root stem>.index.json`, newest first) that holds the order and so the ring:
 * the last {@link RUNS_KEPT} runs per root are kept, older ones deleted. Pure over the `KnowledgeFiles` port
 * the snapshots use.
 *
 * - Files are written atomically (temp, then rename) where the port can rename; the temp name is unique per
 *   process and write (`<name>.<pid>.<time>-<random>.tmp`), so two windows never write the same temp file.
 * - The index is written from the directory listing merged with the new entry (when the port can list), never from
 *   one window's in-memory view; a missing or torn index is rebuilt the same way (read only: `list` never writes).
 * - A run is saved as `running` when it starts and refreshed while it runs; a record still `running` with no
 *   update for {@link RUN_STALE_MS} whose run is not live in this process is read back as `interrupted`.
 * - Run files that no index lists (past the ring) are pruned when a run finishes, except a record still running
 *   (not stale); temp files older than {@link RUN_STALE_MS} are deleted then too.
 */

import { runFileName, runsIndexFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";
import { onTheWireReport } from "./reviewRunRecorder";
import type { KnowledgeRunSummary, KnowledgeStoredRun } from "../knowledgeProtocol";

/** Runs kept per root. */
export const RUNS_KEPT = 20;
/** A `running` record this long without an update, from a run that is not live, was cut off. */
export const RUN_STALE_MS = 30_000;

const RUNS_FOLDER = "runs";
/** Run ids are file names; one from the view is untrusted. */
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface RunStoreOptions {
  keep?: number;
  now?: () => number;
  /** Whether a run is being written by this process right now (never `interrupted`). */
  isLive?: (runId: string) => boolean;
}

export interface RunStore {
  /** Writes the run and trims the root's ring; `prune` also deletes run files no index lists. */
  save(run: KnowledgeStoredRun, opts?: { prune?: boolean }): Promise<void>;
  /** The root's runs, newest first, without their steps, lanes and failures (the failure count stays). */
  list(rootId: string): Promise<KnowledgeRunSummary[]>;
  /** One whole run; undefined when there is none (or the id is not a run id). */
  get(runId: string): Promise<KnowledgeStoredRun | undefined>;
  /** Resolves once every save queued so far (in this process) has finished, failed or not. */
  idle(): Promise<void>;
}

const parse = <T>(text: string | undefined): T | undefined => {
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as T; } catch { return undefined; }
};

/** Temp file, then rename, so a reader never sees half a file; a port that cannot rename writes directly. */
async function writeAtomic(files: KnowledgeFiles, name: string, text: string, at: number): Promise<void> {
  if (!files.rename) { await files.write(name, text); return; }
  const tmp = `${name}.${process.pid}.${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  await files.write(tmp, text);
  await files.rename(tmp, name);
}

/** Saves are serialized (one index, read-modify-write): a later run never loses an earlier one's slot. */
let saving: Promise<unknown> = Promise.resolve();

/** A temp file of `writeAtomic`: the time it was written (ms) is in its name; undefined for any other file. */
const tempWrittenAt = (name: string): number | undefined => {
  const m = /\.\d+\.([0-9a-z]+)-[0-9a-z]+\.tmp$/.exec(name);
  const at = m ? parseInt(m[1]!, 36) : NaN;
  return Number.isFinite(at) ? at : undefined;
};

const isRunFile = (name: string): boolean => name.endsWith(".json") && !name.endsWith(".index.json") && SAFE_RUN_ID.test(name.slice(0, -".json".length));

export function createRunStore(files: KnowledgeFiles, options: RunStoreOptions = {}): RunStore {
  const keep = options.keep ?? RUNS_KEPT;
  const now = options.now ?? (() => Date.now());
  const isLive = options.isLive ?? (() => false);

  const read = async (runId: string): Promise<KnowledgeStoredRun | undefined> =>
    SAFE_RUN_ID.test(runId) ? parse<KnowledgeStoredRun>(await files.read(runFileName(runId))) : undefined;

  /** A record left `running` by a window that closed. */
  const settled = (run: KnowledgeStoredRun): KnowledgeStoredRun =>
    run.outcome === undefined && run.endedAt === undefined && now() - run.updatedAt > RUN_STALE_MS && !isLive(run.id)
      ? { ...run, outcome: "interrupted", endedAt: run.updatedAt }
      : run;

  /** Every run file of the root, newest first, read from the folder (`also`: a record not yet visible there). */
  async function rebuilt(rootId: string, also?: KnowledgeStoredRun): Promise<string[]> {
    if (!files.list) return also ? [also.id] : [];
    const found = new Map<string, KnowledgeStoredRun>();
    for (const name of await files.list(RUNS_FOLDER)) {
      if (!isRunFile(name)) continue;
      const run = await read(name.slice(0, -".json".length));
      if (run && run.root === rootId) found.set(run.id, run);
    }
    if (also) found.set(also.id, also);
    return [...found.values()].sort((x, y) => y.startedAt - x.startedAt || (x.id < y.id ? 1 : -1)).map((r) => r.id);
  }

  const indexedIds = async (rootId: string): Promise<string[] | undefined> => {
    const index = parse<{ ids?: unknown }>(await files.read(runsIndexFileName(rootId)));
    return Array.isArray(index?.ids) ? index.ids.filter((id): id is string => typeof id === "string" && SAFE_RUN_ID.test(id)) : undefined;
  };

  /** The root's run ids, newest first: its index, or a rebuild from the folder when the index is missing or torn (nothing is written). */
  async function idsOf(rootId: string): Promise<string[]> {
    return (await indexedIds(rootId)) ?? (await rebuilt(rootId)).slice(0, keep);
  }

  /** The ids the index is written with: the folder's runs merged with what the on-disk index lists and the new run. */
  async function mergedIds(run: KnowledgeStoredRun): Promise<string[]> {
    const onDisk = (await indexedIds(run.root)) ?? [];
    if (!files.list) return [run.id, ...onDisk.filter((id) => id !== run.id)];
    // The common case, a refresh: the folder holds nothing the index does not know, so no record is read.
    const inFolder = (await files.list(RUNS_FOLDER)).filter(isRunFile).map((n) => n.slice(0, -".json".length));
    const onDiskSet = new Set(onDisk);
    if (inFolder.every((id) => id === run.id || onDiskSet.has(id) || !SAFE_RUN_ID.test(id))) return [run.id, ...onDisk.filter((id) => id !== run.id)];
    const listed = await rebuilt(run.root, run);
    const known = new Set(listed);
    // An index entry the folder does not show (a record another window is mid-write on) keeps its place after the listed ones.
    return [...listed, ...onDisk.filter((id) => !known.has(id))];
  }

  /** Deletes a run file, except a record still being written (running and not stale): another window's live run is never removed. */
  async function removeUnlessRunning(run: KnowledgeStoredRun): Promise<void> {
    if (run.outcome === undefined && now() - run.updatedAt <= RUN_STALE_MS) return;
    await files.remove?.(runFileName(run.id)).catch(() => undefined);
  }

  /** Deletes the root's run files that no index lists: past the ring, or left by a torn index. */
  async function prune(rootId: string, listed: ReadonlySet<string>): Promise<void> {
    if (!files.list || !files.remove) return;
    for (const name of await files.list(RUNS_FOLDER)) {
      if (!isRunFile(name)) continue;
      const id = name.slice(0, -".json".length);
      if (listed.has(id)) continue;
      const run = await read(id);
      if (run && run.root === rootId) await removeUnlessRunning(run);
    }
    // Leftover temp files of a write that never finished.
    for (const name of await files.list(RUNS_FOLDER)) {
      const at = tempWrittenAt(name);
      if (at !== undefined && now() - at > RUN_STALE_MS) await files.remove(`${RUNS_FOLDER}/${name}`).catch(() => undefined);
    }
  }

  return {
    async get(runId) {
      const run = await read(runId);
      return run ? settled(run) : undefined;
    },
    save(run, opts = {}) {
      const done = saving.then(async () => {
        await writeAtomic(files, runFileName(run.id), JSON.stringify(run), now());
        const ids = await mergedIds(run);
        await writeAtomic(files, runsIndexFileName(run.root), JSON.stringify({ ids: ids.slice(0, keep) }), now());
        // A host that cannot delete keeps the files; the index still caps what is listed.
        if (files.remove) for (const old of ids.slice(keep)) { const past = await read(old); if (past) await removeUnlessRunning(past); }
        if (opts.prune) await prune(run.root, new Set(ids.slice(0, keep)));
      });
      saving = done.catch(() => undefined);
      return done;
    },
    async idle() { await saving; },
    async list(rootId) {
      const runs = await Promise.all((await idsOf(rootId)).map((id) => read(id)));
      return runs.flatMap((r) => {
        if (!r) return [];
        const { steps: _steps, lanes: _lanes, failures, report, ...summary } = settled(r);
        return [{ ...summary, ...(report ? { report: onTheWireReport(report) } : {}), failureCount: failures?.length ?? 0 }];
      });
    },
  };
}
