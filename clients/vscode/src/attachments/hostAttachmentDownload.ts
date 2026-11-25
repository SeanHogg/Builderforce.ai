/**
 * The editor's wiring of an attachment's DOWNLOAD (`attachment.download`; the rule is the
 * pure `attachmentDownload.ts`): the extension's credential for the fetch, a progress
 * notification the person can cancel, the save dialog and the write, and the person's
 * sentences for every way it can fail.
 */

import * as os from "node:os";
import * as vscode from "vscode";
import { fetchAuthed } from "./bfApi";
import { downloadAttachment, type AttachmentDownloadRequest } from "./attachmentDownload";
import { ATTACHMENT_DOWNLOAD_MAX_BYTES } from "./attachmentLimits";
import { logLine } from "./errorReporter";
import { messageOf } from "./messageOf";
import { getBaseUrl } from "./gateway";

/**
 * How long one download may take, body included. `fetchAuthed`'s own 60 s bound is for API
 * calls; the largest original ({@link ATTACHMENT_DOWNLOAD_MAX_BYTES}) on a slow link needs
 * longer — ten minutes is 100 MB at ~170 KB/s. The person can cancel sooner.
 */
export const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const couldNotDownload = (name: string, reason: string): string => vscode.l10n.t("Could not download {0}: {1}", name, reason);
const unreachable = (name: string): string => couldNotDownload(name, vscode.l10n.t("BuilderForce could not be reached."));
const tooLarge = (name: string): string =>
  vscode.l10n.t("{0} is too large to download here: the limit is {1} MB.", name, String(Math.round(ATTACHMENT_DOWNLOAD_MAX_BYTES / (1024 * 1024))));

/** GET an attachment's original with the extension's credential, under a cancellable progress. Throws the person's sentence. */
async function fetchOwnAttachment(secrets: vscode.SecretStorage, path: string, name: string): Promise<Uint8Array<ArrayBuffer>> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Downloading {0}…", name), cancellable: true },
    async (_progress, token) => {
      const cancel = new AbortController();
      const sub = token.onCancellationRequested(() => cancel.abort());
      const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(ATTACHMENT_DOWNLOAD_TIMEOUT_MS)]);
      try {
        let res: Response | undefined;
        try {
          // An attachment path only (the caller checked it), and never followed elsewhere.
          res = await fetchAuthed(secrets, path, { method: "GET", redirect: "error", signal });
        } catch (e) {
          logLine(`[download] ${name} failed: ${messageOf(e)}`);
          throw new Error(unreachable(name));
        }
        if (!res) throw new Error(vscode.l10n.t("Sign in to BuilderForce to download {0}.", name));
        if (!res.ok) {
          logLine(`[download] ${name} refused: HTTP ${res.status}`);
          throw new Error(couldNotDownload(name, vscode.l10n.t("BuilderForce answered with an error (HTTP {0}).", res.status)));
        }
        const declared = Number(res.headers.get("content-length") ?? "");
        if (Number.isFinite(declared) && declared > ATTACHMENT_DOWNLOAD_MAX_BYTES) throw new Error(tooLarge(name));
        try {
          // The body is read under the same signal: a stalled or cancelled read ends in the person's sentence.
          return new Uint8Array(await res.arrayBuffer());
        } catch (e) {
          logLine(`[download] ${name} body read failed: ${messageOf(e)}`);
          throw new Error(cancel.signal.aborted ? couldNotDownload(name, vscode.l10n.t("the download was cancelled.")) : unreachable(name));
        }
      } finally {
        sub.dispose();
      }
    },
  );
}

/** Where the save dialog opens: the first workspace folder, else the home folder. */
function saveDialogUri(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
  return vscode.Uri.joinPath(folder, name);
}

/** Save an attachment's original from the panel's preview (`attachment.download`). */
export function hostAttachmentDownload(secrets: vscode.SecretStorage, request: AttachmentDownloadRequest): Promise<{ saved: boolean }> {
  return downloadAttachment<vscode.Uri>(request, {
    baseUrl: getBaseUrl,
    fetchOwn: (path, name) => fetchOwnAttachment(secrets, path, name),
    chooseTarget: async (name) => vscode.window.showSaveDialog({ defaultUri: saveDialogUri(name), saveLabel: vscode.l10n.t("Save") }),
    write: async (uri, bytes) => { await vscode.workspace.fs.writeFile(uri, bytes); },
    unavailable: (name) => vscode.l10n.t("{0} is no longer available to download.", name),
    foreign: (name) => vscode.l10n.t("{0} is not stored in your BuilderForce account, so it cannot be downloaded here.", name),
    tooLarge,
  });
}
