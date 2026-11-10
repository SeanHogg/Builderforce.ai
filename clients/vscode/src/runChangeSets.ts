/**
 * Run-linked immutable change sets (G19).
 *
 * `gitChanges.ts` answers "what is uncommitted RIGHT NOW"; it cannot say what a specific
 * agent run changed. This module captures a content-hashed baseline at run start and a
 * second reading at run end, diffs the two, and commits the result as an immutable
 * `change-set` record linked to the run: repository identity, branch, base commit, and
 * per-file before/after content hashes.
 *
 * Attribution is truthful by construction:
 *
 *   • A file dirty BEFORE the run whose hash did not move is never claimed by the run.
 *   • A file dirty before and changed during the run is recorded with its pre-run hash
 *     as `beforeHash` — the run modified an existing edit; it did not author all of it.
 *   • Hashes are evidence, not diffs: patch/artifact upload is a separate manifest
 *     concern, and nothing here ever applies a change set to another checkout.
 *
 * Records are written once (`changeset:<runId>:<repo>`) and never overwritten — a
 * retried finalization returns the stored record.
 *
 * A second record, `changeset-lifecycle:<runId>`, is the restart boundary. It stores
 * a content hash of the baseline before the run and a finalization only when the set
 * closes. A set with a baseline and no finalization is partial; a finalized set is
 * finished. A restart reads that record. Nothing here fetches or applies a patch.
 *
 * Split along its seams: `runChangeBaseline.ts` (fingerprints, baseline capture,
 * attribution) and `changeSetLifecycle.ts` (the restart boundary). This module closes
 * a run's set and wraps a host start (`recordChangeSetAroundRun`, used by
 * `brainRunHostPorts.ts`).
 */

import { createHash } from "node:crypto";
import {
  defineRecordIndex,
  newLocalRecord,
  type ChangeSetValue,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { detectPendingChanges, refreshPendingChanges } from "./gitChanges";
import { normalizePath } from "./gitChangeModel";
import {
  attributeRunChanges,
  baseCommitOf,
  captureRunChangeBaseline,
  fingerprintFiles,
  repositoryIdentityOf,
  type BaselineCaptureOptions,
  type ChangeAttribution,
  type ChangeSetRepoBaseline,
  type RunChangeBaseline,
  type StatHashHint,
} from "./runChangeBaseline";
import { listWorkingSet, workingSetStatus } from "./runDelta/folderWorkingSet";
import { syncedRepositoryIdentity } from "./repoIdentity";
import {
  deviceIdOf,
  isoDay,
  readChangeSetLifecycle,
  recordChangeSetBaseline,
  recordChangeSetFinalization,
} from "./changeSetLifecycle";

/** What one repository's change-set record carries (extends the shared contract). */
export interface LocalChangeSetValue extends ChangeSetValue {
  /** Always stamped by the writer (the agent that ran), so required locally. */
  author: string;
  capturedAt: string;
  files: Array<{ path: string; beforeHash?: string; afterHash?: string; patchManifestId?: string; attribution: ChangeAttribution; status: string }>;
}

/**
 * The attributed per-repository change sets of one repository (the lifecycle rows are in no group), keyed by the stored
 * (local) identity: what commit attribution reads instead of every change set on the device.
 */
export const CHANGE_SETS_BY_REPOSITORY = defineRecordIndex<LocalChangeSetValue>(
  "change-set", "vscode.changeSet.repository",
  (row) => ((row.payload as { kind?: unknown }).kind === "lifecycle" ? undefined : row.payload.repository),
);

/**
 * The same change sets grouped by repository AND the UTC day they were captured ({@link changeSetDayKey}): the run delta's
 * overlap test reads only the days of its own window, never a repository's whole history.
 */
export const CHANGE_SETS_BY_REPOSITORY_DAY = defineRecordIndex<LocalChangeSetValue>(
  "change-set", "vscode.changeSet.repositoryDay",
  (row) => ((row.payload as { kind?: unknown }).kind === "lifecycle" || typeof row.payload.capturedAt !== "string"
    ? undefined
    : changeSetDayKey(row.payload.repository, row.payload.capturedAt)),
);

/** {@link CHANGE_SETS_BY_REPOSITORY_DAY}'s key: the repository and the UTC day of an ISO time. */
export function changeSetDayKey(repository: string, iso: string): string {
  return `${repository}\n${isoDay(iso)}`;
}

/**
 * What the sync carries for a change set: the record with its repository named by {@link syncedRepositoryIdentity} (no
 * credentials, no local path). The stored record keeps the local identity, which this device's readers look repositories up by.
 */
export function syncedChangeSetPayload(payload: LocalChangeSetValue): LocalChangeSetValue {
  return { ...payload, repository: syncedRepositoryIdentity(payload.repository) };
}

/** The change-set record id is derived from the run and repo, so re-finalizing dedupes. */
export function runChangeSetId(runId: string, repoRoot: string): string {
  const repoKey = createHash("sha256").update(normalizePath(repoRoot)).digest("hex").slice(0, 16);
  return `changeset:${runId}:${repoKey}`;
}

/** One committed change-set record and the repository root it describes. */
export interface CommittedChangeSet {
  id: string;
  root: string;
}

/** A repository's working tree at finalization: a git repo's pending changes, or a non-git folder's working set. */
interface CurrentRepo {
  root: string;
  branch?: string;
  changes: ReadonlyArray<{ path: string; relativePath: string; status: string }>;
}

/** The repositories to diff: every pending git repo, plus every non-git folder the baseline covered. */
async function currentRepos(baseline: RunChangeBaseline): Promise<CurrentRepo[]> {
  // A mid-run read can repopulate the cache. Attribute against a fresh working tree,
  // not that snapshot. This does not upload the diff and does not apply it anywhere.
  refreshPendingChanges();
  const pending = await detectPendingChanges();
  const repos: CurrentRepo[] = [...pending.repos];
  // A folder whose baseline was capped, or read back without its files, cannot be attributed truthfully: it is skipped.
  const folders = baseline.repos.filter((repo): repo is ChangeSetRepoBaseline & { kind: "folder" } =>
    repo.kind === "folder" && !repo.truncated && repo.omittedFiles === undefined);
  for (const folder of folders) {
    if (repos.some((repo) => normalizePath(repo.root) === normalizePath(folder.root))) continue;
    const listed = await listWorkingSet(folder.root);
    if (listed.truncated) continue;
    repos.push({ root: folder.root, changes: workingSetStatus(folder.files, listed.files, folder.root) });
  }
  return repos;
}

/**
 * Close a run's change evidence: re-read the working tree, keep only the changes the
 * run truthfully owns, and commit one immutable change-set per touched repository.
 * Returns the stored records (empty when the run changed nothing).
 */
export async function finalizeRunChangeSets(
  store: LocalFirstStore,
  deps: { deviceId: string; now?: () => Date; hint?: StatHashHint },
  args: {
    runId: string;
    baseline: RunChangeBaseline;
    destination?: EntityDestination;
    /** Truthful actor label, e.g. "agent:audit" — never the user for agent edits. */
    author: string;
  },
): Promise<string[]> {
  return (await finalizeRunChangeSetRepos(store, deps, args)).map((set) => set.id);
}

/** {@link finalizeRunChangeSets}, with the repository root of each committed record (what the run delta reads). */
export async function finalizeRunChangeSetRepos(
  store: LocalFirstStore,
  deps: { deviceId: string; now?: () => Date; hint?: StatHashHint },
  args: {
    runId: string;
    baseline: RunChangeBaseline;
    destination?: EntityDestination;
    author: string;
  },
): Promise<CommittedChangeSet[]> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const current = await currentRepos(args.baseline);
  const committed: CommittedChangeSet[] = [];

  // Baseline repos by normalized root; current repos drive the diff (a repo the run
  // dirtied that was clean at baseline appears only here).
  const baselineByRoot = new Map(args.baseline.repos.map((repo) => [normalizePath(repo.root), repo]));
  const roots = new Set<string>([...current.map((repo) => normalizePath(repo.root))]);

  for (const rootKey of roots) {
    const repo = current.find((candidate) => normalizePath(candidate.root) === rootKey)!;
    const baseline = baselineByRoot.get(rootKey);
    const changes = attributeRunChanges(
      baseline?.files ?? {},
      await fingerprintFiles(repo.changes.map((change) => change.path), deps.hint).then((hashes) =>
        repo.changes.map((change, index) => ({
          relativePath: change.relativePath,
          status: change.status,
          hash: hashes[index],
        })),
      ),
    );
    if (!changes.length) continue;

    const id = runChangeSetId(args.runId, repo.root);
    const existing = await store.read((tx) => tx.get<LocalChangeSetValue>("change-set", id));
    if (existing) {
      committed.push({ id, root: repo.root });
      continue; // immutable: a retried finalization returns the stored record
    }
    const repository = baseline?.repository ?? (await repositoryIdentityOf(repo.root));
    const baseCommit = baseline?.kind === "folder" ? undefined : baseline?.baseCommit ?? (await baseCommitOf(repo.root));
    const record = newLocalRecord<LocalChangeSetValue>({
      id,
      entityType: "change-set",
      deviceId: deps.deviceId,
      destination: args.destination ?? { kind: "unbound" },
      occurredAt: at,
      schemaVersion: 1,
      payload: {
        runId: args.runId,
        repository,
        ...(repo.branch ?? baseline?.branch ? { branch: repo.branch ?? baseline?.branch } : {}),
        ...(baseCommit ? { baseCommit } : {}),
        files: changes.map((change) => ({
          path: change.relativePath,
          ...(change.beforeHash ? { beforeHash: change.beforeHash } : {}),
          ...(change.afterHash ? { afterHash: change.afterHash } : {}),
          attribution: change.attribution,
          status: change.status,
        })),
        author: args.author,
        capturedAt: at,
      },
    });
    await store.transact(async (tx) => {
      await tx.put(record);
      await tx.append({
        eventId: `change-set:create:${id}`,
        clientEntityId: id,
        entityType: "change-set",
        operation: "create",
        schemaVersion: record.schemaVersion,
        occurredAt: at,
        dependsOn: [`execution:start:${args.runId}`],
        destination: record.destination,
        payload: syncedChangeSetPayload(record.payload),
      });
    });
    committed.push({ id, root: repo.root });
  }
  return committed;
}

/** A finalized run's change evidence: what the run delta is computed from. */
export interface FinalizedRunChangeSets {
  runId: string;
  baseline: RunChangeBaseline;
  committed: CommittedChangeSet[];
}

/**
 * Identity of the change set a host-owned start records. An audit run keeps its run
 * id so the record links to that execution; every other start gets its own id,
 * because the record is immutable and a second turn of the same chat must not be
 * dropped. The author is the agent, never the user.
 */
export function changeSetIdentityForHostRun(
  payload: { chatId: number; audit?: { runId?: string } },
  newId: () => string,
): { runId: string; author: string } {
  const auditRunId = payload.audit?.runId?.trim();
  return {
    runId: auditRunId ? auditRunId : `host-run:${payload.chatId}:${newId()}`,
    author: payload.audit ? "agent:audit" : "agent:brain-host",
  };
}

/**
 * Capture a baseline, record its content hash, run the host start, then commit the
 * immutable change set and its finalization. Evidence never fails the run, and
 * nothing here uploads a patch or applies one to another checkout. A start that
 * finds the chat already running did not own the turn (the host no-ops a duplicate)
 * and must not open or close a set — that would claim the live run's edits. A crash
 * after the baseline record and before finalization leaves the set partial.
 */
export async function recordChangeSetAroundRun<T>(
  args: {
    store: LocalFirstStore;
    /** The device id minted by the local store. A getter is read when a record is written, not during the git capture. */
    deviceId: string | (() => string);
    runId: string;
    author: string;
    destination?: EntityDestination;
    /** True when this start did not own the run. */
    stillRunning?: () => boolean;
    now?: () => Date;
    /** Evidence that could not be recorded. The run is never failed for it. Default `console.warn`. */
    onError?: (error: unknown) => void;
    /** How the baseline is read: pre-images, the stat hint (also used at finalization), the workspace folders. */
    capture?: BaselineCaptureOptions;
    /**
     * Told once the set is finalized, with the committed records and the baseline they were diffed against — the run
     * delta's hook (`runDelta/finalizeRunDelta.ts`). Called, never awaited: nothing it does can fail or delay the run's
     * result. A throw is reported to `onError`.
     */
    onFinalized?: (closed: FinalizedRunChangeSets) => void;
  },
  run: () => Promise<T>,
): Promise<T> {
  if (args.stillRunning?.()) return run();
  const onError = args.onError ?? ((error: unknown) => console.warn("change set:", error));
  // Every exit that does not hand the finalized set to `onFinalized` releases the run's pre-images.
  let handedOff = false;
  const release = (): void => {
    if (handedOff) return;
    handedOff = true;
    try { args.capture?.release?.(); } catch (error) { onError(error); }
  };
  let baseline: RunChangeBaseline | undefined;
  try {
    baseline = await captureRunChangeBaseline(args.now?.() ?? new Date(), args.capture);
  } catch (error) {
    onError(error);
    baseline = undefined;
  }
  if (baseline) {
    try {
      const deviceId = deviceIdOf(args.deviceId);
      if (deviceId) {
        await recordChangeSetBaseline(
          args.store,
          { deviceId, ...(args.now ? { now: args.now } : {}) },
          {
            runId: args.runId,
            baseline,
            author: args.author,
            ...(args.destination ? { destination: args.destination } : {}),
          },
        );
      }
    } catch (error) {
      // A missing baseline record must not fail the run.
      onError(error);
    }
  }
  try {
    return await run();
  } finally {
    let deviceId = "";
    let ownsRun = true;
    try {
      deviceId = deviceIdOf(args.deviceId);
      ownsRun = !args.stillRunning?.();
    } catch (error) {
      // Can't tell who owns the turn — don't claim the live run's edits.
      onError(error);
      ownsRun = false;
    }
    if (deviceId && ownsRun) {
      try {
        const stored = await readChangeSetLifecycle(args.store, args.runId);
        // The in-process baseline is whole; the stored one is the restart fallback (a folder's files are not stored).
        const baselineForClose = baseline ?? stored?.baseline;
        if (baselineForClose && !stored?.finalizedAt) {
          const committed = await finalizeRunChangeSetRepos(
            args.store,
            { deviceId, ...(args.now ? { now: args.now } : {}), ...(args.capture?.hint ? { hint: args.capture.hint } : {}) },
            {
              runId: args.runId,
              baseline: baselineForClose,
              author: args.author,
              ...(args.destination ? { destination: args.destination } : {}),
            },
          );
          await recordChangeSetFinalization(
            args.store,
            { deviceId, ...(args.now ? { now: args.now } : {}) },
            {
              runId: args.runId,
              baseline: baselineForClose,
              author: args.author,
              changeSetIds: committed.map((set) => set.id),
              ...(args.destination ? { destination: args.destination } : {}),
            },
          );
          try {
            if (args.onFinalized) {
              handedOff = true; // the delta releases them once it settles
              args.onFinalized({ runId: args.runId, baseline: baselineForClose, committed });
            }
          } catch (error) {
            onError(error);
          }
        }
      } catch (error) {
        // A missing change-set must not fail the run. A recorded baseline stays partial.
        onError(error);
      }
    }
    release();
  }
}
