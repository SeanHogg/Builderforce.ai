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
 */

import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  newLocalRecord,
  type ChangeSetValue,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { detectPendingChanges, refreshPendingChanges, type PendingChangeRepo } from "./gitChanges";
import { runGit } from "./gitApi";
import { normalizePath } from "./gitChangeModel";

/** Files larger than this are fingerprinted by size, not content — hashing is evidence, not backup. */
const MAX_HASH_BYTES = 8 * 1024 * 1024;

/** The content fingerprint of one file at a moment in time. */
export type FileFingerprint = string | undefined;

export interface ChangeSetRepoBaseline {
  root: string;
  name: string;
  /** Remote URL when the repository has one — its durable identity across machines. */
  repository: string;
  branch?: string;
  baseCommit?: string;
  /** Repo-relative POSIX path → content hash, for every file dirty at baseline. */
  files: Record<string, FileFingerprint>;
}

export interface RunChangeBaseline {
  capturedAt: string;
  repos: ChangeSetRepoBaseline[];
}

export type ChangeAttribution =
  /** Clean before the run; the run introduced this file's pending state. */
  | "run-authored"
  /** Dirty before the run; the run changed it further (beforeHash is the pre-run edit). */
  | "run-modified-existing";

export interface AttributedChange {
  relativePath: string;
  status: string;
  beforeHash?: string;
  afterHash?: string;
  attribution: ChangeAttribution;
}

/** What one repository's change-set record carries (extends the shared contract). */
export interface LocalChangeSetValue extends ChangeSetValue {
  capturedAt: string;
  files: Array<{ path: string; beforeHash?: string; afterHash?: string; patchManifestId?: string; attribution: ChangeAttribution; status: string }>;
}

/** Content-hash one file; absent/unreadable → undefined, oversized → a size fingerprint. */
export async function hashFileContent(path: string): Promise<FileFingerprint> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) return undefined;
    if (stat.size > MAX_HASH_BYTES) return `size:${stat.size}`;
    return `sha256:${createHash("sha256").update(await fs.readFile(path)).digest("hex")}`;
  } catch {
    return undefined;
  }
}

/**
 * The attribution diff, host-free: given what was dirty at baseline and what is dirty
 * now (with content hashes both times), which changes does the run truthfully own?
 * Files whose hash did not move are the user's pre-existing edits and are excluded.
 */
export function attributeRunChanges(
  baseline: Record<string, FileFingerprint>,
  current: Array<{ relativePath: string; status: string; hash: FileFingerprint }>,
): AttributedChange[] {
  const out: AttributedChange[] = [];
  for (const file of current) {
    const beforeHash = baseline[file.relativePath];
    const existedAtBaseline = file.relativePath in baseline;
    if (existedAtBaseline && beforeHash === file.hash) continue; // pre-existing edit, untouched by the run
    out.push({
      relativePath: file.relativePath,
      status: file.status,
      ...(existedAtBaseline && beforeHash !== undefined ? { beforeHash } : {}),
      ...(file.hash !== undefined ? { afterHash: file.hash } : {}),
      attribution: existedAtBaseline ? "run-modified-existing" : "run-authored",
    });
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function hashRepoChanges(repo: PendingChangeRepo): Promise<Record<string, FileFingerprint>> {
  const entries = await Promise.all(
    repo.changes.map(async (change) => [change.relativePath, await hashFileContent(change.path)] as const),
  );
  return Object.fromEntries(entries);
}

async function baseCommitOf(root: string): Promise<string | undefined> {
  return (await runGit(root, "rev-parse HEAD")) || undefined;
}

async function repositoryIdentityOf(root: string): Promise<string> {
  const remote = (await runGit(root, "config --get remote.origin.url"))?.trim();
  return remote || root;
}

/**
 * Snapshot every workspace repository's pending work with content hashes. Called at run
 * start; the run's own edits are excluded later by the attribution diff, so this can
 * safely run on an already-dirty tree.
 */
export async function captureRunChangeBaseline(now: Date = new Date()): Promise<RunChangeBaseline> {
  // The pending-change cache can be 15s stale. A stale "clean" snapshot would later
  // attribute the user's pre-existing dirty files to this run.
  refreshPendingChanges();
  const pending = await detectPendingChanges();
  const repos: ChangeSetRepoBaseline[] = [];
  for (const repo of pending.repos) {
    const baseCommit = await baseCommitOf(repo.root);
    repos.push({
      root: repo.root,
      name: repo.name,
      repository: await repositoryIdentityOf(repo.root),
      ...(repo.branch ? { branch: repo.branch } : {}),
      ...(baseCommit ? { baseCommit } : {}),
      files: await hashRepoChanges(repo),
    });
  }
  return { capturedAt: now.toISOString(), repos };
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
      await Promise.all(
        repo.changes.map(async (change) => ({
          relativePath: change.relativePath,
          status: change.status,
          hash: await hashFileContent(change.path),
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
 * Capture a baseline, run the host start, then commit the immutable change set.
 * Evidence never fails the run, and nothing here uploads a patch or applies one to
 * another checkout. A start that finds the chat already running did not own the
 * turn (the host no-ops a duplicate) and must not finalize — that would claim the
 * live run's edits.
 */
export async function recordChangeSetAroundRun<T>(
  args: {
    store: LocalFirstStore;
    /** The device id minted by the local store. A getter is read at finalize, not at capture. */
    deviceId: string | (() => string);
    runId: string;
    author: string;
    destination?: EntityDestination;
    /** True when this start did not own the run. */
    stillRunning?: () => boolean;
    now?: () => Date;
  },
  run: () => Promise<T>,
): Promise<T> {
  if (args.stillRunning?.()) return run();
  let baseline: RunChangeBaseline | undefined;
  try {
    baseline = await captureRunChangeBaseline(args.now?.() ?? new Date());
  } catch {
    baseline = undefined;
  }
  try {
    return await run();
  } finally {
    let deviceId = "";
    let ownsRun = true;
    try {
      deviceId = typeof args.deviceId === "function" ? args.deviceId() : args.deviceId;
      ownsRun = !args.stillRunning?.();
    } catch {
      // Can't tell who owns the turn — don't claim the live run's edits.
      ownsRun = false;
    }
    if (baseline && deviceId && ownsRun) {
      try {
        await finalizeRunChangeSets(
          args.store,
          { deviceId, ...(args.now ? { now: args.now } : {}) },
          {
            runId: args.runId,
            baseline,
            author: args.author,
            ...(args.destination ? { destination: args.destination } : {}),
          },
        );
      } catch {
        // A missing change-set must not fail the run.
      }
    }
  }
}
