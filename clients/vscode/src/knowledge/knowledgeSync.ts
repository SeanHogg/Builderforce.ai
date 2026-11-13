/**
 * The editor's `syncStatus` (PRD 38, Option B+ Contract 4; PRD 41 A7): assembles the pure status
 * (`knowledgeSyncStatus.ts`) from this root's ports. Nothing here walks the tree.
 *
 *   local    ALWAYS the local graph's counts (`graphCounts` of the graph built from the local store),
 *            linked or not; the last review's recorded counts win for files and docs (the plan's
 *            counts: the docs pack's files are the docs, skipped files are not counted);
 *   server   the linked project's graph when it is reachable; counts from its `stats` (not from the
 *            capped nodes), `truncated` when the cap cut the file/doc split. The ONLY use the editor
 *            makes of `GET /knowledge-graph`;
 *   replica  the replica dirty set's state (dirty keys / last pack / parts / sending / waiting / failed), when linked;
 *   skipped  the last review's recorded list (persisted per root); absent = unknown.
 */

import type * as vscode from "vscode";
import { graphCounts } from "@builderforce/agent-tools/knowledge";
import { gitHistoryPort } from "@builderforce/agent-tools/node-git-history";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import type { KnowledgeSyncStatus } from "./knowledgeProtocol";
import { replicaStatusOf, retryReplica } from "./knowledgeReplica";
import type { KnowledgeRoot } from "./knowledgeRoots";
import { loadGraph, log, openRoot } from "./knowledgeService";
import { buildSyncStatus, reviewRecords } from "./knowledgeSyncStatus";
import { EVENT_LOOP_YIELD_EVERY, eventLoopYield } from "./vscodeDirectorySource";

/** The widest graph the platform builds; only its `stats` and a docs split are read. */
const COUNT_MAX_NODES = 2000;

/**
 * How long a `syncStatus` answer may wait on the linked project's graph fetch. The
 * status renders fine from LOCAL counts alone — the server graph only enriches it — so
 * an offline or slow platform must never stall the webview's request (the bridge times
 * it out after 300 s, and the whole point of this read is "is my knowledge synced?").
 * When the fetch hasn't settled in time the answer goes out without `server` and the
 * next read picks the figure up.
 */
const SERVER_GRAPH_TIMEOUT_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(undefined); },
    );
  });
}

export async function rootSyncStatus(
  secrets: vscode.SecretStorage,
  root: KnowledgeRoot,
  opts?: { serverTimeoutMs?: number },
): Promise<KnowledgeSyncStatus> {
  const open = openRoot(secrets, root);
  const record = reviewRecords.get(root.rootId);
  // The server graph is an ENRICHMENT, never a gate: race it against a short bound so
  // the answer always goes out on local counts, even offline.
  const serverTimeoutMs = opts?.serverTimeoutMs ?? SERVER_GRAPH_TIMEOUT_MS;
  const [serverGraph, graph] = await Promise.all([
    open.client ? withTimeout(open.client.graph(root.rootId, { maxNodes: COUNT_MAX_NODES }), serverTimeoutMs) : null,
    loadGraph(secrets, root.rootId, { maxNodes: COUNT_MAX_NODES }),
  ]);
  const server = serverGraph ? graphCounts(serverGraph) : undefined;
  const measured = graph ? graphCounts(graph) : undefined;
  const local = {
    files: record?.counts.files ?? measured?.files ?? 0,
    docs: record?.counts.docs ?? measured?.docs ?? 0,
    // The edge count is the local graph's; absent = not measured.
    ...(measured?.edges !== undefined ? { edges: measured.edges } : record?.counts.edges !== undefined ? { edges: record.counts.edges } : {}),
    ...(!record && measured?.truncated ? { truncated: true } : {}),
  };
  const replica = open.pump ? await replicaStatusOf(root.rootId, open.files) : undefined;
  return buildSyncStatus({
    fs: vscodeKnowledgeFs(),
    rootPath: root.rootPath,
    local,
    ...(server ? { server } : {}),
    ...(replica ? { replica } : {}),
    skipped: record?.skipped,
    reviewed: !!record || !!graph || !!server,
    hasHistory: (await gitHistoryPort(root.rootPath, { onWarn: (m) => log("history", m) })) !== undefined,
  });
}

/** Retry upload: clears the root's recorded upload failures and drains its replica queue now; resolves once the pump has started (not when it ends). A root that is not linked has nothing to send. */
export function retryRootSync(secrets: vscode.SecretStorage, root: KnowledgeRoot): Promise<void> {
  const open = openRoot(secrets, root);
  if (open.pump) retryReplica(open.pump);
  return Promise.resolve();
}
