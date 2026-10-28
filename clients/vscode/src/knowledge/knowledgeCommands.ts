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
 *     activation), every root reviewed while unlinked uploads its local snapshot once.
 */

import * as vscode from "vscode";
import { openWorkspace } from "../openWorkspace";
import { getSelectedProject, onProjectChange } from "../projectState";
import { VisualizationPanel } from "../visualizationPanel";
import { rootIdOfSourceRef } from "@builderforce/agent-tools/knowledge";
import { reviewArgumentOf, reviewedRoots, rootById, rootForPath } from "./knowledgeRoots";
import { configureKnowledgeHost, linkedKnowledgeClient, log, rootKnowledgeFiles, workspaceFolders } from "./knowledgeService";
import { uploadLocalSnapshot, type UploadMarks } from "./knowledgeStores";

/** The ONE globalState key recording which project each root's local snapshot went to. */
export const KNOWLEDGE_UPLOADED_KEY = "builderforce.knowledge.uploaded";

function uploadMarks(state: vscode.Memento): UploadMarks {
  const read = (): Record<string, number> => state.get<Record<string, number>>(KNOWLEDGE_UPLOADED_KEY) ?? {};
  return {
    get: (rootId) => read()[rootId],
    set: (rootId, projectId) => Promise.resolve(state.update(KNOWLEDGE_UPLOADED_KEY, { ...read(), [rootId]: projectId })),
  };
}

/** Linking uploads what was reviewed locally (§5.1). Idempotent: a root goes to a project once. */
async function uploadReviewedRoots(context: vscode.ExtensionContext, projectId: number): Promise<void> {
  const client = linkedKnowledgeClient(context.secrets);
  if (!client) return;
  const marks = uploadMarks(context.globalState);
  let uploaded = 0;
  for (const listed of reviewedRoots(context.workspaceState)) {
    // A root listed under its old id resolves to its current one (and its migrated files).
    const root = rootById(listed, workspaceFolders());
    if (!root) continue;
    const { rootId } = root;
    try {
      const done = await uploadLocalSnapshot({ rootId, files: rootKnowledgeFiles(root), client, projectId, marks });
      if (done) uploaded += 1;
    } catch (error) {
      log(`upload ${rootId}`, error);
    }
  }
  if (uploaded > 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("BuilderForce: the knowledge of {0} reviewed folder(s) was uploaded to the linked project.", uploaded),
    );
  }
}

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

export function registerKnowledgeCommands(context: vscode.ExtensionContext): void {
  configureKnowledgeHost(context.workspaceState);
  context.subscriptions.push(
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
    onProjectChange((project) => {
      if (project) void uploadReviewedRoots(context, project.id);
    }),
  );
  const linked = getSelectedProject();
  if (linked) void uploadReviewedRoots(context, linked.id);
}
