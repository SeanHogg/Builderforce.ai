/**
 * The editor's wiring of context ingress (`contextIngress.ts`, `attachmentIngress.ts`):
 * the extension's credential for uploads, the mention budget of the route the next turn
 * takes, and the C8 compressor behind its cost lever. One ingress per extension host, so
 * a text stored from one chat surface is found by the send (or the steer) from another.
 */

import * as vscode from "vscode";
import { brainUploadUrl, signedBrainFileUrl, BRAIN_UPLOAD_PATH, BRAIN_UPLOAD_SIGN_PATH, NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { mentionBudget, type MentionBudget } from "@builderforce/tool-output-policy";
import { authed, authedRaw } from "./bfApi";
import { desktopCompressProse } from "./desktopContext";
import { logLine } from "./errorReporter";
import { getBaseUrl } from "./gateway";
import { hostCostLeverOn } from "./hostCostLevers";
import { localWindowProbes, resolveModelRoute, type ModelRoute } from "./modelRouting";
import { createAttachmentIngress, uploadRefusal, type AttachmentIngress, type OutgoingFile, type UploadedAttachment } from "./attachmentIngress";
import { currentInferenceMode } from "./inferenceModeSetting";
import type { IngressDeps } from "./contextIngress";

/**
 * The mention budget for a turn on `route`: the local row (sized by the model's reported
 * window when its runtime reports one) for a turn pinned to this machine or in Local
 * only; the cloud row otherwise — a local-first turn falls over to the gateway, and its
 * window fit packs for whichever model answers.
 */
export async function routeMentionBudget(route: ModelRoute): Promise<MentionBudget> {
  if (!route.local && route.inferenceMode !== "local-only") return mentionBudget("cloud");
  let contextWindowTokens: number | undefined;
  if (route.local) {
    try {
      const pin = route.local;
      contextWindowTokens = (await localWindowProbes())
        .flatMap((p) => p.models)
        .find((m) => m.provider === pin.provider && m.model === pin.model)?.contextTokens;
    } catch { /* unknown window: the default local row */ }
  }
  return mentionBudget("local", contextWindowTokens ? { contextWindowTokens } : {});
}

/**
 * The C8 step for ingress: the Desktop compressor while lever `c8_token_compression` is
 * on (read per call — the lever and the Desktop service can change while the editor
 * runs), savings recorded on the output channel.
 */
export function hostIngressDeps(): IngressDeps {
  return {
    compress: (text, kind, opts) => (hostCostLeverOn("c8_token_compression")
      ? desktopCompressProse(text, kind, opts)
      : Promise.resolve({ text, compressed: false, originalTokens: 0, keptTokens: 0 })),
    log: logLine,
  };
}

/** What `POST /api/brain/upload` answers (201 `{ key, name, type }`, else `{ error }`). */
type UploadAnswer = { key?: string; name?: string; type?: string; error?: string };

const megabytes = (bytes: number): string => String(Math.round((bytes / (1024 * 1024)) * 10) / 10);

const signInToAttach = (name: string): string =>
  vscode.l10n.t("Sign in to BuilderForce to attach {0}: files other than text are uploaded to your account so the model can open them.", name);

/**
 * Throws the person's sentence when `file` may not be uploaded: Local only keeps every
 * file on this machine, and a file over the platform's ceiling is refused before it is
 * sent (`uploadRefusal` — the ONE rule; `admit` and the upload both ask it).
 */
export function admitUpload(file: OutgoingFile): void {
  const refusal = uploadRefusal(file, currentInferenceMode());
  if (!refusal) return;
  if (refusal.reason === "local-only") {
    throw new Error(vscode.l10n.t("Local only is on, so {0} stays on this machine: files other than text are attached by uploading them to your account. Switch to Hybrid to attach it.", file.name));
  }
  throw new Error(vscode.l10n.t("{0} is too large to attach: the limit is {1} MB.", file.name, megabytes(refusal.maxBytes)));
}

/**
 * Why the platform refused an upload, for the person — never the server's raw English.
 * The size is checked before sending, so a 400 is a type the platform does not store.
 */
export function uploadFailureReason(name: string, status: number): string {
  if (status === 401 || status === 403) return signInToAttach(name);
  let reason: string;
  if (status === 400 || status === 415) reason = vscode.l10n.t("BuilderForce does not accept this kind of file.");
  else if (status === 413) reason = vscode.l10n.t("the file is larger than BuilderForce accepts.");
  else if (status >= 500) reason = vscode.l10n.t("file storage is unavailable right now. Try again later.");
  else reason = vscode.l10n.t("BuilderForce answered with an error (HTTP {0}).", status);
  return vscode.l10n.t("Could not upload {0}: {1}", name, reason);
}

/** Upload one file to the account with the extension's credential. Throws the person's sentence. */
async function uploadToAccount(secrets: vscode.SecretStorage, file: { name: string; mime: string; bytes: Uint8Array<ArrayBuffer> }): Promise<UploadedAttachment> {
  // Enforced here too, so no path reaches the account in Local only or over the ceiling.
  admitUpload({ name: file.name, mime: file.mime, size: file.bytes.byteLength });
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.mime }), file.name);
  let answer: { status: number; body: UploadAnswer | undefined };
  try {
    answer = await authedRaw<UploadAnswer>(secrets, BRAIN_UPLOAD_PATH, { method: "POST", body: form });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === NOT_SIGNED_IN) throw new Error(signInToAttach(file.name));
    logLine(`[ingress] upload of ${file.name} failed: ${message}`);
    throw new Error(vscode.l10n.t("Could not upload {0}: {1}", file.name, vscode.l10n.t("BuilderForce could not be reached.")));
  }
  const key = answer.body?.key;
  if (answer.status < 200 || answer.status >= 300 || !key) {
    logLine(`[ingress] upload of ${file.name} refused: HTTP ${answer.status} ${answer.body?.error ?? ""}`);
    throw new Error(uploadFailureReason(file.name, answer.status));
  }
  return { key, name: answer.body?.name ?? file.name, type: answer.body?.type ?? file.mime, url: brainUploadUrl(getBaseUrl(), key) };
}

/** A short-lived public URL for an uploaded key (a picture too large to inline). */
async function signUpload(secrets: vscode.SecretStorage, key: string): Promise<string> {
  // A public URL handed to a cloud model is a cloud path too.
  if (currentInferenceMode() === "local-only") {
    throw new Error(vscode.l10n.t("Local only is on, so large pictures stay on this machine. Switch to Hybrid to attach them."));
  }
  const signed = await authed<{ exp: number; sig: string }>(secrets, BRAIN_UPLOAD_SIGN_PATH, { method: "POST", body: JSON.stringify({ key }) });
  if (!signed) throw new Error(vscode.l10n.t("Sign in to BuilderForce to attach large pictures."));
  return signedBrainFileUrl(getBaseUrl(), key, signed);
}

let ingress: AttachmentIngress | undefined;

/** The extension host's ONE attachment ingress. */
export function hostAttachmentIngress(secrets: vscode.SecretStorage): AttachmentIngress {
  ingress ??= createAttachmentIngress({
    ...hostIngressDeps(),
    admit: admitUpload,
    upload: (file) => uploadToAccount(secrets, file),
    textTooLarge: (name, maxChars) => vscode.l10n.t("{0} is too large to attach: the limit is {1} MB.", name, megabytes(maxChars)),
    sign: (key) => signUpload(secrets, key),
    // Not a `turn` resolve: sizing the budget must never start provisioning a local model.
    budget: async () => routeMentionBudget(await resolveModelRoute(secrets)),
  });
  return ingress;
}
