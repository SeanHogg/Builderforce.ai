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

import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { filesManifestKey, type KnowledgeStore } from "@seanhogg/builderforce-memory/knowledge";
import { migrateLegacyKnowledge, nodeKnowledgeStore, type NodeKnowledgeStore } from "@builderforce/agent-tools/node-knowledge-store.js";
import {
  createReplicaHost, forgetRootPorts, migratingRootFiles, rootManifest, rootStore,
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
    process.once("exit", () => { void host?.disposeReplicas(); });
  }
  return host;
}

/** A root's local ports: its files (legacy ids migrated), its ONE local store and its manifest, shared by the review and the watcher. */
export interface OnPremRootPorts {
  files: KnowledgeFiles;
  local: KnowledgeStore;
  manifest: IngestManifest;
}

/**
 * The root's ports. The root's old `<stem>.manifest.json` is imported once, when the manifest is first opened; a root reviewed
 * under its old, name-based id keeps its manifest and graph.
 */
export function onPremRootPorts(workspaceRoot: string, rootId: string, legacyRootId: string | undefined): OnPremRootPorts {
  const files = migratingRootFiles(containerKnowledgeFiles(workspaceRoot), rootId, legacyRootId);
  const local = rootStore(rootId, () => folderOf(workspaceRoot).store, "local");
  const manifest = rootManifest(rootId, () => {
    const folder = folderOf(workspaceRoot);
    void migrateLegacyKnowledge(files, folder, rootId, {
      ...(legacyRootId ? { legacyRootId } : {}),
      log: (line) => logDebug(`[knowledge] ${line}`),
    }).catch(loggedFallback("legacy manifest import", undefined));
    return folder.manifest;
  }, workspaceRoot);
  return { files, local, manifest };
}

/** What the pump sends from: the root's local store to the linked project. */
export function onPremPumpSource(rootId: string, ports: OnPremRootPorts, linked: { client: KnowledgeClient; projectId: number }): PumpSource {
  return { rootId, files: ports.files, local: ports.local, client: linked.client, projectId: linked.projectId, manifest: ports.manifest };
}

/**
 * A root reviewed against the server before the local-first path (its manifest has entries but the local store has no scope for it)
 * is ADDITIVE: its pump must never delete a server leaf the new, empty local store lacks.
 */
export async function adoptServerReviewedRoot(rootId: string, ports: OnPremRootPorts): Promise<void> {
  if ((await ports.local.scopes()).some((s) => s.rootId === rootId)) return;
  if (((await ports.manifest.get(filesManifestKey(rootId))) ?? []).length === 0) return;
  await onPremReplicaHost().markAdditive(rootId, ports.files);
}

/** Waits (bounded) for the root's upload to drain; logs when it is still sending. Never throws, never hangs. */
export async function drainAfterReview(rootId: string, ms = 120_000): Promise<"drained" | "pending"> {
  const state = await onPremReplicaHost().drainedWithin(rootId, ms).catch(loggedFallback("replica drain", "pending" as const));
  if (state === "pending") logDebug(`[knowledge] ${rootId}: the upload to the project is still sending; it continues in the background`);
  return state;
}
