/**
 * "Remove Uploaded Knowledge Pack" (PRD 40, OD-2): deletes a pack root that was uploaded to
 * the linked project (`DELETE …/knowledge/scopes/:rootId`; the server refuses anything that is
 * not a `pack:` root). Destructive for every member of the project, so it is the one place a
 * modal approval is used.
 */

import * as vscode from "vscode";
import { KnowledgeApiError } from "@builderforce/knowledge-client";
import { provenanceDetail } from "./packProvenanceDetail";
import { linkedProjectClient, messageOf } from "./packUi";
import { registerPackUploadCommand } from "./packUpload";

async function removeUploadedPack(context: vscode.ExtensionContext): Promise<void> {
  const linked = linkedProjectClient(context);
  if (!linked) return;
  try {
    const packs = (await linked.client.scopes()).filter((s) => s.kind === "pack");
    if (packs.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: this project has no uploaded knowledge packs."));
      return;
    }
    const picked = await vscode.window.showQuickPick(
      packs.map((s) => {
        const detail = provenanceDetail(s.provenance);
        return { label: s.title || s.rootId, description: s.rootId, ...(detail ? { detail } : {}), rootId: s.rootId };
      }),
      { placeHolder: vscode.l10n.t("Choose the uploaded knowledge pack to remove") },
    );
    if (!picked) return;
    const remove = vscode.l10n.t("Remove Knowledge Pack");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t("Remove the knowledge pack \"{0}\" from {1}? Its facts and relations are deleted for every member of the project.", picked.label, linked.project.name),
      { modal: true },
      remove,
    );
    if (confirmed !== remove) return;
    await linked.client.deleteRoot(picked.rootId);
    void vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: knowledge pack \"{0}\" removed from {1}.", picked.label, linked.project.name));
  } catch (error) {
    if (error instanceof KnowledgeApiError && error.status === 403) {
      void vscode.window.showWarningMessage(vscode.l10n.t("Only the person who uploaded this pack or a manager can remove it."));
      return;
    }
    void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not remove the knowledge pack: {0}", messageOf(error)));
  }
}

/** The two platform pack commands (upload, remove) — registered from `registerKnowledgePackCommands` with one line. */
export function registerPackPlatformCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    registerPackUploadCommand(context),
    vscode.commands.registerCommand("builderforce.removeUploadedKnowledgePack", () => removeUploadedPack(context)),
  ];
}
