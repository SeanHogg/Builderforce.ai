/**
 * THE ON-PREM REPLICA (PRD 38 §4.7, "ONE upload path"): the review writes the workspace folder's
 * LOCAL knowledge store; the shared replica host (`@builderforce/agent-tools/knowledge`) sends it
 * to the linked project as ONE compact pack, the same path the editor takes — never a per-file
 * `PUT …/extracted/:hash`.
 *
 * This file holds what the on-prem composition adds around that host: the folder's one SQLite
 * store (per workspace folder, closed at exit), the process-wide host, a root's ports, the pump
 * source, and the adoption of a root that was reviewed against the server before this path existed.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import type { KnowledgeStore } from "@seanhogg/builderforce-memory/knowledge";
import { migrateLegacyKnowledge, nodeKnowledgeStore, type NodeKnowledgeStore } from "@builderforce/agent-tools/node-knowledge-store.js";
import {
  createReplicaHost, dirtyFileName, forgetRootPorts, migratingRootFiles, rootManifest, rootStore, shouldStayAdditive,
  type KnowledgeFiles, type PumpSource, type ReplicaHost,
} from "@builderforce/agent-tools/knowledge/index.js";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { logDebug } from "../../logger.js";
import { containerKnowledgeFiles } from "./containerKnowledgeFs.js";
import { loggedFallback } from "./loggedFallback.js";

/** One store per workspace folder (manifest keys carry their root id, so every root shares it), closed when the process exits. */
const folders = new Map<string, NodeKnowledgeStore>();
let closeAtExit = false;

/** Closes every folder's store connection (shutdown; tests). */
export function closeOnPremManifests(): void {
  for (const folder of folders.values()) folder.close();
  folders.clear();
  migrations.clear();
  forgetRootPorts(); // the per-root caches hold the closed handles
}

function folderOf(workspaceRoot: string): NodeKnowledgeStore {
  let folder = folders.get(workspaceRoot);
  if (!folder) {
    folders.set(workspaceRoot, (folder = nodeKnowledgeStore(workspaceRoot)));
    if (!closeAtExit) {
      closeAtExit = true;
      process.once("exit", closeOnPremManifests);
    }
  }
  return folder;
}

/** The process-wide replica host: every root's queue, pump and drain. */
let host: ReplicaHost | undefined;
export function onPremReplicaHost(): ReplicaHost {
  if (!host) {
    host = createReplicaHost({ report: (what, error) => logDebug(`[knowledge] replica ${what}: ${error instanceof Error ? error.message : String(error)}`) });
    flushReplicasOnExit();
  }
  return host;
}

/**
 * Queue marks are flushed (awaited) before the process leaves: `beforeExit` (a drained loop) and SIGINT/SIGTERM. A signal
 * handler suppresses Node's default exit, so once flushed it re-raises the signal unless another handler owns the exit.
 * `exit` keeps a synchronous best effort (async work cannot finish there).
 */
function flushReplicasOnExit(): void {
  const flush = (): Promise<void> => host?.disposeReplicas().catch(() => undefined) ?? Promise.resolve();
  process.once("beforeExit", () => { void flush(); });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const onSignal = (): void => {
      void flush().then(() => {
        process.off(signal, onSignal);
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    };
    process.once(signal, onSignal);
  }
  process.once("exit", () => { void host?.disposeReplicas(); });
}

/** A root's local ports: its files (legacy ids migrated), its ONE local store and its manifest, shared by the review and the watcher. */
export interface OnPremRootPorts {
  files: KnowledgeFiles;
  local: KnowledgeStore;
  manifest: IngestManifest;
  /** Resolves when the root's legacy files are imported (never rejects); a read of the manifest that must see them awaits it. */
  migrated: Promise<void>;
}

/** Each root's legacy import, started once when its manifest is first opened. */
const migrations = new Map<string, Promise<void>>();

/**
 * The root's ports. The root's old `<stem>.manifest.json` is imported once, when the manifest is first opened; a root reviewed
 * under its old, name-based id keeps its manifest and graph.
 */
export function onPremRootPorts(workspaceRoot: string, rootId: string, legacyRootId: string | undefined): OnPremRootPorts {
  const files = migratingRootFiles(containerKnowledgeFiles(workspaceRoot), rootId, legacyRootId);
  const local = rootStore(rootId, () => folderOf(workspaceRoot).store, "local");
  const migrationKey = `${workspaceRoot}\u0000${rootId}`;
  const manifest = rootManifest(rootId, () => {
    const folder = folderOf(workspaceRoot);
    migrations.set(migrationKey, migrateLegacyKnowledge(files, folder, rootId, {
      ...(legacyRootId ? { legacyRootId } : {}),
      log: (line) => logDebug(`[knowledge] ${line}`),
    }).then(() => undefined, loggedFallback("legacy manifest import", undefined)));
    return folder.manifest;
  }, workspaceRoot);
  return { files, local, manifest, migrated: migrations.get(migrationKey) ?? Promise.resolve() };
}

/** What the pump sends from: the root's local store to the linked project. */
export function onPremPumpSource(rootId: string, ports: OnPremRootPorts, linked: { client: KnowledgeClient; projectId: number }): PumpSource {
  return { rootId, files: ports.files, local: ports.local, client: linked.client, projectId: linked.projectId, manifest: ports.manifest };
}

/**
 * Before every review and every resume: a root with no completed local review is ADDITIVE (the ONE shared rule,
 * `shouldStayAdditive`) — its pump must never delete a server leaf the not-yet-complete local store lacks.
 */
export async function markAdditiveUntilReviewed(rootId: string, ports: OnPremRootPorts): Promise<void> {
  await ports.migrated; // the legacy import must have run before the local store is judged
  if (await shouldStayAdditive(ports.local, rootId)) await onPremReplicaHost().markAdditive(rootId, ports.files);
}

/**
 * Resumes the pending upload of EVERY root of the workspace that has a queue (`*.dirty.json`), not just the base one. A queue file
 * name is a lossy stem of its root id, so the ids are the base root plus the roots the local store holds a scope for; each is
 * matched by `dirtyFileName`. Every failure is logged, never thrown.
 */
export async function resumeQueuedReplicas(
  workspaceRoot: string, baseRootId: string, baseLegacyId: string | undefined, linked: { client: KnowledgeClient; projectId: number },
): Promise<void> {
  const resume = async (rootId: string, ports: OnPremRootPorts): Promise<void> => {
    await markAdditiveUntilReviewed(rootId, ports);
    await onPremReplicaHost().resumeReplica(onPremPumpSource(rootId, ports, linked));
  };
  const base = onPremRootPorts(workspaceRoot, baseRootId, baseLegacyId);
  const failed = loggedFallback("replica resume", undefined);
  await resume(baseRootId, base).catch(failed);
  try {
    const queued = new Set(await readdir(join(workspaceRoot, ".builderforce", "knowledge")).catch(() => [] as string[]));
    if (![...queued].some((name) => name.endsWith(".dirty.json"))) return;
    await base.migrated;
    const ids = new Set((await base.local.scopes()).map((s) => s.rootId));
    for (const rootId of ids) {
      if (rootId === baseRootId || !queued.has(dirtyFileName(rootId))) continue;
      await resume(rootId, onPremRootPorts(workspaceRoot, rootId, undefined)).catch(failed);
    }
  } catch (error) {
    failed(error);
  }
}

/** Waits (bounded) for the root's upload to drain; logs when it is still sending. Never throws, never hangs. */
export async function drainAfterReview(rootId: string, ms = 120_000): Promise<"drained" | "pending"> {
  const state = await onPremReplicaHost().drainedWithin(rootId, ms).catch(loggedFallback("replica drain", "pending" as const));
  if (state === "pending") logDebug(`[knowledge] ${rootId}: the upload to the project is still sending; it continues in the background`);
  return state;
}
