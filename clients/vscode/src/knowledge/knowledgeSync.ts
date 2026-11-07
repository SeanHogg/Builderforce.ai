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
import { replicaStatusOf } from "./knowledgeReplica";
import type { KnowledgeRoot } from "./knowledgeRoots";
import { loadGraph, log, openRoot } from "./knowledgeService";
import { buildSyncStatus, reviewRecords } from "./knowledgeSyncStatus";

/** The widest graph the platform builds; only its `stats` and a docs split are read. */
const COUNT_MAX_NODES = 2000;

export async function rootSyncStatus(secrets: vscode.SecretStorage, root: KnowledgeRoot): Promise<KnowledgeSyncStatus> {
  const open = openRoot(secrets, root);
  const record = reviewRecords.get(root.rootId);
  const [serverGraph, graph] = await Promise.all([
    open.client ? open.client.graph(root.rootId, { maxNodes: COUNT_MAX_NODES }).catch(() => null) : null,
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
