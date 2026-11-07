/**
 * "Upload Knowledge Pack" (PRD 40, OD-2): a `.bfpack` becomes a knowledge ROOT of the project
 * the editor is linked to — no pack table. The pack is rebased onto `packRootIdFor(name, its
 * original root id)` (the `pack:` host segment is what marks it) and pushed through THE writer
 * the linked review uses (the replica pump's first-sync case; the server stamps the root as each fact's source).
 * Uploading a pack that is already there REPLACES it: after a confirmation the old root is
 * removed (by provenance) first, so sources and facts the new pack dropped do not linger.
 *
 * Removing an uploaded pack is the sibling command in `packRemove.ts`.
 */

import * as vscode from "vscode";
import { isWellFormedPackRootId, packRootIdFor, rebasePackRoot, type PortableKnowledgePack } from "@builderforce/agent-tools/knowledge";
import { KnowledgeApiError } from "@builderforce/knowledge-client";
import { loadedPackRegistry } from "./loadedPackRegistry";
import { readPackFile } from "./packIndexing";
import { PackUploadIncomplete, PackUploadUnreachable, pushPack } from "./packPush";
import { PACK_FILTER, linkedProjectClient, messageOf } from "./packUi";

/** The pack file to upload: a loaded pack the person picks, else a `.bfpack` they choose. */
async function pickPackFile(): Promise<string | undefined> {
  const loaded = loadedPackRegistry().all().filter((e) => !!e.path);
  const chooseFile = vscode.l10n.t("Choose a .bfpack file…");
  if (loaded.length > 0) {
    const picked = await vscode.window.showQuickPick(
      [...loaded.map((e) => ({ label: e.name, description: e.path ?? "", file: e.path })), { label: chooseFile, description: "", file: undefined }],
      { placeHolder: vscode.l10n.t("Choose the knowledge pack to upload") },
    );
    if (!picked) return undefined;
    if (picked.file) return picked.file;
  }
  const file = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: PACK_FILTER,
    openLabel: vscode.l10n.t("Upload Knowledge Pack"),
  });
  return file?.[0]?.fsPath;
}

/**
 * The pack as the platform stores it: rebased onto its `pack:` root (collision-resistant: the
 * slug of its name plus a hash of its original root id), with a scope titled like the pack.
 * A pack already on a `pack:` root keeps it, so a pack that was downloaded back re-uploads in place.
 */
export function packForUpload(pack: PortableKnowledgePack): PortableKnowledgePack {
  const rootId = isWellFormedPackRootId(pack.rootId) ? pack.rootId : packRootIdFor(pack.name, pack.rootId);
  const rebased = rebasePackRoot(pack, rootId);
  const known = rebased.snapshot.scopes.find((s) => s.rootId === rebased.rootId);
  // The pack's provenance (OD-3) rides its scope; the server keeps it for pack roots only.
  const scope = { ...(known ?? { packs: [] }), rootId: rebased.rootId, title: rebased.title, ...(pack.provenance ? { provenance: pack.provenance } : {}) };
  return { ...rebased, snapshot: { ...rebased.snapshot, scopes: [scope, ...rebased.snapshot.scopes.filter((s) => s.rootId !== rebased.rootId)] } };
}

async function uploadKnowledgePack(context: vscode.ExtensionContext): Promise<void> {
  const linked = linkedProjectClient(context);
  if (!linked) return;
  const file = await pickPackFile();
  if (!file) return;
  try {
    const pack = packForUpload(await readPackFile(file));
    const exists = (await linked.client.scopes()).some((s) => s.rootId === pack.rootId);
    if (exists) {
      const replace = vscode.l10n.t("Replace Knowledge Pack");
      const confirmed = await vscode.window.showWarningMessage(
        vscode.l10n.t("The knowledge pack \"{0}\" is already uploaded to {1}. Replace it? Sources and facts the new file no longer contains are removed for every member of the project.", pack.name, linked.project.name),
        { modal: true },
        replace,
      );
      if (confirmed !== replace) return;
    }
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("BuilderForce: uploading knowledge pack \"{0}\"…", pack.name),
        cancellable: true,
      },
      async (progress, token) => {
        // Replace = remove (by provenance, server-side) then push, so nothing the pack dropped accumulates.
        if (exists) await linked.client.deleteRoot(pack.rootId);
        let last = 0;
        const abort = new AbortController();
        const cancelled = token.onCancellationRequested(() => abort.abort());
        try {
          return await pushPack(pack, linked.client, abort.signal, (done, total) => {
            progress.report({ increment: total > 0 ? (Math.max(0, done - last) / total) * 100 : 0, message: vscode.l10n.t("{0} of {1} sources", done, total) });
            last = Math.max(last, done);
          });
        } finally {
          cancelled.dispose();
        }
      },
    );
    if (!result) return; // cancelled: the pack is partly there, and uploading again replaces it
    void vscode.window.showInformationMessage(vscode.l10n.t(
      "BuilderForce: knowledge pack \"{0}\" uploaded to {1} ({2} sources, {3} facts, {4} relations).",
      pack.name, linked.project.name, result.sources, result.facts, result.relations,
    ));
  } catch (error) {
    // The server's 403: replacing a pack is the uploader's, a manager's or a superadmin's (the role is not known here,
    // so the server decides; the replace removes the old root first, so a refusal leaves it untouched).
    if (error instanceof KnowledgeApiError && error.status === 403) {
      void vscode.window.showWarningMessage(vscode.l10n.t("Only the person who uploaded this pack or a manager can replace it."));
      return;
    }
    if (error instanceof PackUploadUnreachable) {
      // Never wait forever: stop, say so, and let the person retry.
      const retry = vscode.l10n.t("Retry");
      const picked = await vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not upload the knowledge pack: {0}", vscode.l10n.t("The server could not be reached. The upload stopped.")), retry);
      if (picked === retry) await uploadKnowledgePack(context);
      return;
    }
    if (error instanceof PackUploadIncomplete) {
      // Skipped or refused rows: what is on the project is NOT the whole pack, so there is no success message.
      void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not upload the knowledge pack: {0}", vscode.l10n.t("The pack is incomplete on the project: {0} item(s) were refused or too large to store.", error.items)));
      return;
    }
    void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not upload the knowledge pack: {0}", messageOf(error)));
  }
}

/** The upload command, registered from `registerPackPlatformCommands` (`packRemove.ts`). */
export function registerPackUploadCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("builderforce.uploadKnowledgePack", () => uploadKnowledgePack(context));
}
