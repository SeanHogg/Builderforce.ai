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
  type ChangeAttribution,
  type RunChangeBaseline,
} from "./runChangeBaseline";
import {
  deviceIdOf,
  readChangeSetLifecycle,
  recordChangeSetBaseline,
  recordChangeSetFinalization,
} from "./changeSetLifecycle";

/** What one repository's change-set record carries (extends the shared contract). */
export interface LocalChangeSetValue extends ChangeSetValue {
  capturedAt: string;
  files: Array<{ path: string; beforeHash?: string; afterHash?: string; patchManifestId?: string; attribution: ChangeAttribution; status: string }>;
}

/** The change-set record id is derived from the run and repo, so re-finalizing dedupes. */
export function runChangeSetId(runId: string, repoRoot: string): string {
  const repoKey = createHash("sha256").update(normalizePath(repoRoot)).digest("hex").slice(0, 16);
  return `changeset:${runId}:${repoKey}`;
}

/**
 * Close a run's change evidence: re-read the working tree, keep only the changes the
 * run truthfully owns, and commit one immutable change-set per touched repository.
 * Returns the stored records (empty when the run changed nothing).
 */
export async function finalizeRunChangeSets(
  store: LocalFirstStore,
  deps: { deviceId: string; now?: () => Date },
  args: {
    runId: string;
    baseline: RunChangeBaseline;
    destination?: EntityDestination;
    /** Truthful actor label, e.g. "agent:audit" — never the user for agent edits. */
    author: string;
  },
): Promise<string[]> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  // A mid-run read can repopulate the cache. Attribute against a fresh working tree,
  // not that snapshot. This does not upload the diff and does not apply it anywhere.
  refreshPendingChanges();
  const current = await detectPendingChanges();
  const committed: string[] = [];

  // Baseline repos by normalized root; current repos drive the diff (a repo the run
  // dirtied that was clean at baseline appears only here).
  const baselineByRoot = new Map(args.baseline.repos.map((repo) => [normalizePath(repo.root), repo]));
  const roots = new Set<string>([...current.repos.map((repo) => normalizePath(repo.root))]);

  for (const rootKey of roots) {
    const repo = current.repos.find((candidate) => normalizePath(candidate.root) === rootKey)!;
    const baseline = baselineByRoot.get(rootKey);
    const changes = attributeRunChanges(
      baseline?.files ?? {},
      await fingerprintFiles(repo.changes.map((change) => change.path)).then((hashes) =>
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
      committed.push(id);
      continue; // immutable: a retried finalization returns the stored record
    }
    const repository = baseline?.repository ?? (await repositoryIdentityOf(repo.root));
    const baseCommit = baseline?.baseCommit ?? (await baseCommitOf(repo.root));
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
        payload: record.payload,
      });
    });
    committed.push(id);
  }
  return committed;
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
  },
  run: () => Promise<T>,
): Promise<T> {
  if (args.stillRunning?.()) return run();
  const onError = args.onError ?? ((error: unknown) => console.warn("change set:", error));
  let baseline: RunChangeBaseline | undefined;
  try {
    baseline = await captureRunChangeBaseline(args.now?.() ?? new Date());
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
        const baselineForClose = stored?.baseline ?? baseline;
        if (baselineForClose && !stored?.finalizedAt) {
          const ids = await finalizeRunChangeSets(
            args.store,
            { deviceId, ...(args.now ? { now: args.now } : {}) },
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
              changeSetIds: ids,
              ...(args.destination ? { destination: args.destination } : {}),
            },
          );
        }
      } catch (error) {
        // A missing change-set must not fail the run. A recorded baseline stays partial.
        onError(error);
      }
    }
  }
}
