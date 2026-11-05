/**
 * The editor's `syncStatus` (PRD 38, Option B+ Contract 4): assembles the pure status
 * (`knowledgeSyncStatus.ts`) from this root's ports. Nothing here walks the tree.
 *
 *   server   the linked project's graph; counts from its `stats` (not from the capped nodes),
 *            `truncated` when the cap cut the file/doc split;
 *   local    what the root's last review recorded (the plan's counts: the docs pack's files
 *            are the docs, skipped files are not counted). Unlinked, the edge count is
 *            the local graph's; linked, the editor keeps no local graph, so `edges` is
 *            absent rather than a copy of the platform's;
 *   skipped  the last review's recorded list (persisted per root); absent = unknown.
 */

import type * as vscode from "vscode";
import { graphCounts } from "@builderforce/agent-tools/knowledge";
import { gitHistoryPort } from "@builderforce/agent-tools/node-git-history";
import { vscodeKnowledgeFs } from "./knowledgeFs";
import type { KnowledgeSyncCounts, KnowledgeSyncStatus } from "./knowledgeProtocol";
import type { KnowledgeRoot } from "./knowledgeRoots";
import { loadGraph, log, openRoot } from "./knowledgeService";
import { buildSyncStatus, reviewRecords } from "./knowledgeSyncStatus";

/** The widest graph the platform builds; only its `stats` and a docs split are read. */
const COUNT_MAX_NODES = 2000;

export async function rootSyncStatus(secrets: vscode.SecretStorage, root: KnowledgeRoot): Promise<KnowledgeSyncStatus> {
  const open = openRoot(secrets, root);
  const record = reviewRecords.get(root.rootId);
  const serverGraph = open.client ? await open.client.graph(root.rootId, { maxNodes: COUNT_MAX_NODES }).catch(() => null) : null;
  const server = serverGraph ? graphCounts(serverGraph) : undefined;
  let local: KnowledgeSyncCounts;
  if (open.client) {
    // The edge count is the repo map's, measured by the last review that built it; absent = not measured.
    local = {
      files: record?.counts.files ?? 0,
      docs: record?.counts.docs ?? 0,
      ...(record?.counts.edges !== undefined ? { edges: record.counts.edges } : {}),
    };
  } else {
    const graph = await loadGraph(secrets, root.rootId, { maxNodes: COUNT_MAX_NODES });
    const measured = graph ? graphCounts(graph) : undefined;
    local = {
      files: record?.counts.files ?? measured?.files ?? 0,
      docs: record?.counts.docs ?? measured?.docs ?? 0,
      ...(measured?.edges !== undefined ? { edges: measured.edges } : {}),
      ...(!record && measured?.truncated ? { truncated: true } : {}),
    };
  }
  return buildSyncStatus({
    fs: vscodeKnowledgeFs(),
    rootPath: root.rootPath,
    local,
    ...(server ? { server } : {}),
    skipped: record?.skipped,
    reviewed: !!record || !!server,
    hasHistory: (await gitHistoryPort(root.rootPath, { onWarn: (m) => log("history", m) })) !== undefined,
  });
}
