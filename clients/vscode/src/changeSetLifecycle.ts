/**
 * The restart boundary of a run's change set (G19): `changeset-lifecycle:<runId>`
 * stores a content hash of the baseline before the run and a finalization only when
 * the set closes. A set with a baseline and no finalization is partial; a finalized
 * set is finished. Split out of `runChangeSets.ts`. Nothing here fetches or applies a
 * patch.
 */

import { createHash } from "node:crypto";
import {
  newLocalRecord,
  type ChangeSetValue,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { normalizePath } from "./gitChangeModel";
import type { RunChangeBaseline } from "./runChangeBaseline";

/**
 * One per run. Distinct from {@link runChangeSetId} so the immutable per-repo diff
 * is never overwritten when the set opens or closes.
 */
export function changeSetLifecycleId(runId: string): string {
  return `changeset-lifecycle:${runId}`;
}

export type ChangeSetCompleteness = "partial" | "finished" | "absent";

/**
 * What a restart needs from one run's change set. `baselineHash` is a content hash
 * of repo identity and file fingerprints, not of the clock. `finalizedAt` is absent
 * until the set closes.
 */
export interface ChangeSetLifecycle {
  runId: string;
  baselineHash: string;
  baseline: RunChangeBaseline;
  author: string;
  finalizedAt?: string;
  finalizationHash?: string;
  changeSetIds?: string[];
}

/** Stored shape. `files` stays empty so this record is never an attributed diff. */
export interface ChangeSetLifecycleValue extends ChangeSetValue {
  kind: "lifecycle";
  baselineHash: string;
  baseline: RunChangeBaseline;
  finalizedAt?: string;
  finalizationHash?: string;
  changeSetIds?: string[];
}

/** Content hash of the baseline snapshot. Key order and path spelling do not change it. */
export function hashRunChangeBaseline(baseline: Pick<RunChangeBaseline, "repos">): string {
  const canonical = baseline.repos
    .map((repo) => ({
      baseCommit: repo.baseCommit ?? null,
      branch: repo.branch ?? null,
      files: Object.keys(repo.files)
        .sort((a, b) => a.localeCompare(b))
        .map((filePath) => [filePath, repo.files[filePath] ?? null] as const),
      name: repo.name,
      repository: repo.repository,
      root: normalizePath(repo.root),
    }))
    .sort((a, b) => a.root.localeCompare(b.root) || a.repository.localeCompare(b.repository));
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

/** Content hash of a close: the baseline it closed, and the change-set ids it committed. */
export function hashChangeSetFinalization(input: { baselineHash: string; changeSetIds: readonly string[] }): string {
  const canonical = {
    baselineHash: input.baselineHash,
    changeSetIds: [...input.changeSetIds].sort((a, b) => a.localeCompare(b)),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

/**
 * A set with a baseline and no finalization is partial. A finalized set is finished.
 * Anything else was never opened.
 */
export function changeSetCompleteness(set: {
  baselineHash?: string;
  finalizedAt?: string;
}): ChangeSetCompleteness {
  if (typeof set.finalizedAt === "string" && set.finalizedAt.length > 0) return "finished";
  if (typeof set.baselineHash === "string" && set.baselineHash.length > 0) return "partial";
  return "absent";
}

export function isPartialChangeSet(set: { baselineHash?: string; finalizedAt?: string }): boolean {
  return changeSetCompleteness(set) === "partial";
}

export function isFinishedChangeSet(set: { baselineHash?: string; finalizedAt?: string }): boolean {
  return changeSetCompleteness(set) === "finished";
}

export function isChangeSetLifecycle(payload: unknown): payload is ChangeSetLifecycleValue {
  return Boolean(payload && typeof payload === "object" && (payload as { kind?: unknown }).kind === "lifecycle");
}

/** Open a set. Host-free: no store, no fetch. The result is partial. */
export function beginChangeSet(args: {
  runId: string;
  baseline: RunChangeBaseline;
  author: string;
}): ChangeSetLifecycle {
  return {
    runId: args.runId,
    baselineHash: hashRunChangeBaseline(args.baseline),
    baseline: args.baseline,
    author: args.author,
  };
}

/**
 * Close a set. A second call returns the stored close unchanged — finalization is
 * written once. Host-free: no store, no fetch.
 */
export function finishChangeSet(
  open: ChangeSetLifecycle,
  args: { finalizedAt: string; changeSetIds: readonly string[] },
): ChangeSetLifecycle {
  if (open.finalizedAt) return open;
  const changeSetIds = [...args.changeSetIds].sort((a, b) => a.localeCompare(b));
  return {
    ...open,
    changeSetIds,
    finalizedAt: args.finalizedAt,
    finalizationHash: hashChangeSetFinalization({ baselineHash: open.baselineHash, changeSetIds }),
  };
}

function lifecyclePayload(set: ChangeSetLifecycle): ChangeSetLifecycleValue {
  const repository = set.baseline.repos.map((repo) => repo.repository).sort().join("\n") || "workspace";
  return {
    kind: "lifecycle",
    runId: set.runId,
    repository,
    files: [],
    author: set.author,
    baselineHash: set.baselineHash,
    baseline: set.baseline,
    ...(set.finalizedAt ? { finalizedAt: set.finalizedAt } : {}),
    ...(set.finalizationHash ? { finalizationHash: set.finalizationHash } : {}),
    ...(set.changeSetIds ? { changeSetIds: set.changeSetIds } : {}),
  };
}

function lifecycleFromPayload(payload: ChangeSetLifecycleValue): ChangeSetLifecycle {
  return {
    runId: payload.runId,
    baselineHash: payload.baselineHash,
    baseline: payload.baseline,
    author: payload.author ?? "",
    ...(payload.finalizedAt ? { finalizedAt: payload.finalizedAt } : {}),
    ...(payload.finalizationHash ? { finalizationHash: payload.finalizationHash } : {}),
    ...(payload.changeSetIds ? { changeSetIds: payload.changeSetIds } : {}),
  };
}

export function deviceIdOf(deviceId: string | (() => string)): string {
  const value = typeof deviceId === "function" ? deviceId() : deviceId;
  return typeof value === "string" ? value : "";
}

/** Read the restart boundary. Absent when this run never recorded a baseline. */
export async function readChangeSetLifecycle(
  store: LocalFirstStore,
  runId: string,
): Promise<ChangeSetLifecycleValue | undefined> {
  const record = await store.read((tx) => tx.get<ChangeSetLifecycleValue>("change-set", changeSetLifecycleId(runId)));
  return record && isChangeSetLifecycle(record.payload) ? record.payload : undefined;
}

/** What a restart should believe about this run's change set. No fetch. */
export async function readRunChangeSetPhase(
  store: LocalFirstStore,
  runId: string,
): Promise<ChangeSetCompleteness> {
  const payload = await readChangeSetLifecycle(store, runId);
  return payload ? changeSetCompleteness(payload) : "absent";
}

/**
 * Record the content-hashed baseline. Written once: a retry, including one that
 * already finalized, does not replace the hash a restart will read.
 */
export async function recordChangeSetBaseline(
  store: LocalFirstStore,
  deps: { deviceId: string; now?: () => Date },
  args: {
    runId: string;
    baseline: RunChangeBaseline;
    author: string;
    destination?: EntityDestination;
  },
): Promise<ChangeSetLifecycle> {
  const opened = beginChangeSet(args);
  if (!deps.deviceId) return opened;
  const id = changeSetLifecycleId(args.runId);
  const at = args.baseline.capturedAt || (deps.now?.() ?? new Date()).toISOString();
  await store.transact(async (tx) => {
    const existing = await tx.get<ChangeSetLifecycleValue>("change-set", id);
    if (existing) return;
    const record = newLocalRecord<ChangeSetLifecycleValue>({
      id,
      entityType: "change-set",
      deviceId: deps.deviceId,
      destination: args.destination ?? { kind: "unbound" },
      occurredAt: at,
      schemaVersion: 1,
      payload: lifecyclePayload(opened),
    });
    await tx.put(record);
    await tx.append({
      eventId: `change-set:baseline:${id}`,
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
  const stored = await readChangeSetLifecycle(store, args.runId);
  return stored ? lifecycleFromPayload(stored) : opened;
}

/**
 * Record finalization. A set that was only baselined becomes finished; a second
 * call returns the stored close. No fetch, and this does not apply a patch.
 */
export async function recordChangeSetFinalization(
  store: LocalFirstStore,
  deps: { deviceId: string; now?: () => Date },
  args: {
    runId: string;
    baseline: RunChangeBaseline;
    author: string;
    changeSetIds: readonly string[];
    destination?: EntityDestination;
  },
): Promise<ChangeSetLifecycle> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const opened = beginChangeSet(args);
  if (!deps.deviceId) return finishChangeSet(opened, { finalizedAt: at, changeSetIds: args.changeSetIds });
  const id = changeSetLifecycleId(args.runId);
  await store.transact(async (tx) => {
    const existing = await tx.get<ChangeSetLifecycleValue>("change-set", id);
    if (existing?.payload.finalizedAt) return;
    const open = existing && isChangeSetLifecycle(existing.payload) ? lifecycleFromPayload(existing.payload) : opened;
    const finished = finishChangeSet(open, { finalizedAt: at, changeSetIds: args.changeSetIds });
    const payload = lifecyclePayload(finished);
    if (!existing) {
      const record = newLocalRecord<ChangeSetLifecycleValue>({
        id,
        entityType: "change-set",
        deviceId: deps.deviceId,
        destination: args.destination ?? { kind: "unbound" },
        occurredAt: at,
        schemaVersion: 1,
        payload,
      });
      await tx.put(record);
      await tx.append({
        eventId: `change-set:finalize:${id}`,
        clientEntityId: id,
        entityType: "change-set",
        operation: "create",
        schemaVersion: record.schemaVersion,
        occurredAt: at,
        dependsOn: [`execution:start:${args.runId}`],
        destination: record.destination,
        payload: record.payload,
      });
      return;
    }
    await tx.put<ChangeSetLifecycleValue>(
      { ...existing, version: existing.version + 1, updatedAt: at, payload },
      existing.version,
    );
    await tx.append({
      eventId: `change-set:finalize:${id}`,
      clientEntityId: id,
      entityType: "change-set",
      operation: "update",
      schemaVersion: existing.schemaVersion,
      occurredAt: at,
      dependsOn: [`change-set:baseline:${id}`],
      destination: existing.destination,
      payload,
    });
  });
  const stored = await readChangeSetLifecycle(store, args.runId);
  return stored ? lifecycleFromPayload(stored) : finishChangeSet(opened, { finalizedAt: at, changeSetIds: args.changeSetIds });
}

