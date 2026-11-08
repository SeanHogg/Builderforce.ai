/**
 * The knowledge graph's editor entry points (PRD 38 §3.1, §4.7) — registered here so
 * `extension.ts` grows by one call:
 *
 *   - `builderforce.reviewFolder` — **Review with BuilderForce** on a folder in the
 *     explorer: the ONE composer, seeded with `/review <folder>` — the gate's
 *     `knowledge.review-dir` row then shows the confirm chip with the plan's numbers;
 *   - `builderforce.openKnowledgeGraph` `{ focus?, rootId? }` — the Visualization panel on
 *     its Knowledge view, focused (Open in graph chips, `/graph`);
 *   - linking: when the workspace is linked to a project (the selected project, now or at
 *     activation), every reviewed root queues its local snapshot for it once (the replica pump
 *     sends it in the background), and a queue left waiting by an earlier session resumes.
 */

import * as vscode from "vscode";
import { openWorkspace } from "../openWorkspace";
import { onProjectChange } from "../projectState";
import { VisualizationPanel } from "../visualizationPanel";
import { rootIdOfSourceRef } from "@builderforce/agent-tools/knowledge";
import { reviewArgumentOf, rootForPath } from "./knowledgeRoots";
import { registerKnowledgePackCommands } from "./knowledgePackCommands";
import { configureKnowledgeHost, linkedProject, workspaceFolders } from "./knowledgeService";
import { pendingBinding, type PendingBinding } from "./pendingBinding";
import { configureExtractPool, disposeExtractPool } from "./review/extractPoolHost";
import { BuilderForceAuthProvider } from "../auth";
import { disposeReplicas, resumeAuthPaused } from "./knowledgeReplica";
import { closeFolderKnowledge } from "./folderKnowledge";
import { replicateReviewedRoots } from "./knowledgeReplicate";

/** The folder the command was invoked on (explorer), else the one the person picks. */
async function folderToReview(uri: unknown): Promise<vscode.Uri | undefined> {
  if (uri instanceof vscode.Uri) return uri;
  const first = vscode.workspace.workspaceFolders?.[0]?.uri;
  return (await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t("Review with BuilderForce"),
    ...(first ? { defaultUri: first } : {}),
  }))?.[0];
}

let pending: PendingBinding | undefined;

/** Call on every capability change: a selection made signed out binds when the link is granted. */
export function checkPendingKnowledgeBinding(): Promise<void> {
  return pending?.check() ?? Promise.resolve();
}

export function registerKnowledgeCommands(context: vscode.ExtensionContext): void {
  configureKnowledgeHost(context.workspaceState);
  pending = pendingBinding({
    linkedTo: () => linkedProject()?.id,
    onLink: () => replicateReviewedRoots(context, true),
    onUnlink: async () => { await replicateReviewedRoots(context, false); },
  });
  // The review's extraction pool lives as long as the extension (started on the first review).
  configureExtractPool(context.extensionPath);
  // (the pool's width is `min(cores - 1, 8)`; at one it is not used and the review runs at memory's default width)
  registerKnowledgePackCommands(context);
  context.subscriptions.push(
    { dispose: disposeExtractPool },
    vscode.commands.registerCommand("builderforce.reviewFolder", async (uri?: unknown) => {
      const target = await folderToReview(uri);
      if (!target) return;
      const folders = workspaceFolders();
      const root = rootForPath(target.fsPath, folders);
      if (!root) {
        void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce reviews folders inside the open workspace."));
        return;
      }
      await openWorkspace(context, { kind: "seed", text: `/review ${reviewArgumentOf(root, folders)}` });
    }),
    vscode.commands.registerCommand("builderforce.openKnowledgeGraph", (args?: { focus?: unknown; rootId?: unknown }) => {
      const focus = Array.isArray(args?.focus) ? args.focus.filter((f): f is string => typeof f === "string") : [];
      const rootId = typeof args?.rootId === "string" ? args.rootId : focus.map(rootIdOfSourceRef).find((r): r is string => !!r);
      return VisualizationPanel.openKnowledge(context, { focus, ...(rootId ? { rootId } : {}) });
    }),
    // A selection change re-evaluates the link edge (the watcher owns it; never replicates directly).
    onProjectChange(() => { void pending?.check(); }),
    // A pump that paused because the token was refused resumes when the person signs in again.
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === BuilderForceAuthProvider.id) void resumeAuthPaused();
    }),
    // Queues are made durable and pumps stop with the extension (the queues resume on the next open); then the folders' SQLite connections close.
    { dispose: () => { void disposeReplicas().finally(closeFolderKnowledge); } },
  );
  void pending.check();
}
