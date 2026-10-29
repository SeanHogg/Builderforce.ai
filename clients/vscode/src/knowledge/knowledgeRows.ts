/**
 * The editor's HOST half of the knowledge-graph PreFetch rows (PRD 38 §4.9): the shared
 * `knowledge.review-dir` and `knowledge.graph` rows and executors
 * (`@builderforce/agent-tools/prefetch`, merged by its `withKnowledgeRows`) over THIS host:
 *
 *   - a review opens the named folder through the editor's knowledge host (the same review
 *     the panel and the explorer menu run); the confirm chip is the run's own pending
 *     confirm, carrying the plan's numbers (the executor's `preview`);
 *   - "show me the graph" — and the end of a review — open the Visualization panel on its
 *     Knowledge view, focused on the files the request names, with an Open in graph chip.
 *
 * Kept out of `vscodePrefetchPort.ts`, which only assembles the editor's own port.
 */

import * as vscode from "vscode";
import {
  OPEN_KNOWLEDGE_GRAPH_COMMAND, graphShown, type KnowledgeRowsHost,
} from "@builderforce/agent-tools/prefetch";
import { editorCallPrice } from "./knowledgeCallPrice";
import { knowledgeRootId, rootForRelative } from "./knowledgeRoots";
import { reviewRoot, workspaceFolders } from "./knowledgeService";

/** Whether `path` is a folder on disk. */
async function isFolder(path: string): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(vscode.Uri.file(path))).type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

export function editorKnowledgeRowsHost(secrets: vscode.SecretStorage): KnowledgeRowsHost {
  return {
    async openReview(dir) {
      const root = rootForRelative(dir, workspaceFolders());
      if (!root || !(await isFolder(root.rootPath))) return null;
      const review = reviewRoot(secrets, root);
      return {
        rootId: root.rootId,
        title: root.title,
        plan: () => review.plan(),
        review: (plan, signal) => review.run({ signal, plan }),
      };
    },
    callPrice: editorCallPrice(secrets),
    rootId() {
      const first = workspaceFolders()[0];
      return first ? knowledgeRootId(first.path) : "workspace";
    },
    async showGraph(rootId, focus) {
      const args = { rootId, focus };
      await vscode.commands.executeCommand(OPEN_KNOWLEDGE_GRAPH_COMMAND, args);
      const text = focus.length > 0
        ? `Opened the knowledge graph of **${rootId}**, focused on ${focus.length} file(s).`
        : `Opened the knowledge graph of **${rootId}**.`;
      return graphShown(text, rootId, focus);
    },
  };
}
