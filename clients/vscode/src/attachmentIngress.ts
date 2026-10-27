/**
 * The extension host's half of the panel's attachments (`attachment.ingress`), so what
 * the person attaches actually reaches the model. The webview keeps only a preview
 * `blob:` URL — a link the model cannot open — so:
 *
 *   • `store`  — a TEXT attachment (a text file, "Add context") is kept here, by its
 *                attachment key, until the turn that carries it is sent (one text over
 *                {@link MAX_STORED_TEXT_CHARS} is refused; the oldest are forgotten past
 *                {@link MAX_STORED_ATTACHMENT_TEXTS} texts or {@link MAX_STORED_TOTAL_CHARS});
 *   • `inline` — at send (and for a message steered into a running run) those texts
 *                become the turn's inlined block (`contextIngress.ts`: C8 for prose, the
 *                mention budget for everything);
 *   • `admit`  — whether a BINARY may be uploaded at all, asked BEFORE its bytes are
 *                encoded and posted (Local only refuses every cloud upload; a file over
 *                the platform's ceiling is refused up front);
 *   • `upload` — a BINARY (a PDF, a picture too large to inline) is uploaded to the account
 *                with the extension's credential, so the turn can name an object the
 *                platform's `builtin_attachments_read` can open. Admitted again on the
 *                encoded length before a byte is decoded;
 *   • `sign`   — a short-lived public URL for an uploaded picture too large to inline.
 *
 * The file's MIME type travels as `mime`: `type` is the bridge frame's own field.
 *
 * Pure (no `vscode`): the network, the budget, the compressor and the person's sentences
 * are injected (`hostIngress.ts` wires them).
 */

import { MAX_INLINE_TEXT_BYTES } from "@seanhogg/builderforce-brain-embedded";
import type { InferenceMode } from "@builderforce/local-first";
import { inlineMentions, mentionBudget, type MentionBudget } from "@builderforce/tool-output-policy";
import { ingressBlock, type IngressDeps, type IngressText } from "./contextIngress";

/** Texts kept at once. A pending attachment that was never sent is forgotten oldest first. */
export const MAX_STORED_ATTACHMENT_TEXTS = 64;
/** One stored text's ceiling — the most the panel ever reads as text (`MAX_INLINE_TEXT_BYTES`). */
export const MAX_STORED_TEXT_CHARS = MAX_INLINE_TEXT_BYTES;
/** All stored texts together; past it the oldest are forgotten. */
export const MAX_STORED_TOTAL_CHARS = 8 * MAX_STORED_TEXT_CHARS;

/**
 * The platform's upload ceiling for a MIME type — mirrors `assetMaxBytes` in
 * `api/src/application/assets/tenantAssetStore.ts` (held equal by `attachmentLimits.test.ts`).
 * Checked here so a file the platform will refuse is never encoded, posted and sent.
 */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export function uploadMaxBytes(mime: string): number {
  return mime.startsWith("video/") ? UPLOAD_MAX_VIDEO_BYTES : UPLOAD_MAX_BYTES;
}

/** Why a file may not go to the account, or null when it may. */
export type UploadRefusal = { reason: "local-only" } | { reason: "too-large"; maxBytes: number };

/** The ONE admission rule for a cloud upload (see the header). */
export function uploadRefusal(file: { mime: string; size: number }, mode: InferenceMode): UploadRefusal | null {
  if (mode === "local-only") return { reason: "local-only" };
  const maxBytes = uploadMaxBytes(file.mime);
  return file.size > maxBytes ? { reason: "too-large", maxBytes } : null;
}

/** An uploaded object, as the platform answers it, with the URL a turn names it by. */
export interface UploadedAttachment {
  key: string;
  name: string;
  type: string;
  url: string;
}

/** A file on its way to the account. */
export interface OutgoingFile {
  name: string;
  mime: string;
  size: number;
}

export interface AttachmentIngressPorts extends IngressDeps {
  /** Throws the person's sentence when `file` may not be uploaded (Local only, too large). */
  admit(file: OutgoingFile): void;
  /** Upload bytes to the account; throws a sentence for the person (signed out, refused). */
  upload(file: { name: string; mime: string; bytes: Uint8Array<ArrayBuffer> }): Promise<UploadedAttachment>;
  /** A short-lived public URL for an uploaded key. */
  sign(key: string): Promise<string>;
  /** The mention budget of the turn being sent now. */
  budget(): Promise<MentionBudget>;
  /** The person's sentence for a text too large to keep for the turn. */
  textTooLarge(name: string, maxChars: number): string;
}

/** What the webview sends. Untyped on purpose: it crossed a process boundary. */
export interface AttachmentIngressRequest {
  op?: unknown;
  key?: unknown;
  name?: unknown;
  /** `admit` / `upload`: the file's MIME type. */
  mime?: unknown;
  /** `admit`: the file's size in bytes. */
  size?: unknown;
  text?: unknown;
  /** `upload`: the file's bytes, base64. */
  data?: unknown;
  /** `inline`: the turn's attachments. */
  attachments?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Decode base64 (the webview's transfer form of a file's bytes). */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(data, "base64"));
}

/** The byte length `data` (base64) decodes to — known before decoding it. */
export function decodedLengthOf(data: string): number {
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - pad);
}

type AttachmentRef = { key: string; name?: string };

export interface AttachmentIngress {
  handle(request: AttachmentIngressRequest): Promise<unknown>;
  /** The inlined block for these attachments' stored texts, with the keys it covered. */
  inline(attachments: readonly AttachmentRef[]): Promise<{ text: string; keys: string[] } | null>;
  /**
   * `text` with the stored texts of `attachments` inlined after it (a steered message).
   * Synchronous and FIT ONLY — no compression, no route lookup — under the budget of the
   * turn last sent (the run being steered; the smaller local row before any send), so a
   * steer is queued the moment it arrives.
   */
  withInlined(text: string, attachments: readonly AttachmentRef[] | undefined): string;
}

export function createAttachmentIngress(ports: AttachmentIngressPorts): AttachmentIngress {
  const texts = new Map<string, IngressText>();
  let storedChars = 0;
  /** The budget of the turn last sent: the run a steer goes into. */
  let lastBudget: MentionBudget | undefined;

  const forget = (key: string): void => {
    const was = texts.get(key);
    if (!was) return;
    storedChars -= was.text.length;
    texts.delete(key);
  };

  const store = (key: string, entry: IngressText): void => {
    if (entry.text.length > MAX_STORED_TEXT_CHARS) throw new Error(ports.textTooLarge(entry.name, MAX_STORED_TEXT_CHARS));
    forget(key);
    texts.set(key, entry);
    storedChars += entry.text.length;
    while (texts.size > MAX_STORED_ATTACHMENT_TEXTS || storedChars > MAX_STORED_TOTAL_CHARS) forget(texts.keys().next().value as string);
  };

  const inline = async (attachments: readonly AttachmentRef[]): Promise<{ text: string; keys: string[] } | null> => {
    const found = attachments.filter((a) => texts.has(a.key));
    if (found.length === 0) return null;
    lastBudget = await ports.budget();
    const text = await ingressBlock(found.map((a) => texts.get(a.key)!), lastBudget, ports);
    return text ? { text, keys: found.map((a) => a.key) } : null;
  };

  return {
    inline,
    withInlined(text, attachments) {
      const entries = (attachments ?? []).flatMap((a) => texts.get(a.key) ?? []);
      if (entries.length === 0) return text;
      const block = inlineMentions(entries, lastBudget ?? mentionBudget("local"));
      return block ? `${text}\n\n${block}` : text;
    },
    async handle(request) {
      switch (request.op) {
        case "store": {
          const key = str(request.key);
          if (!key || typeof request.text !== "string") throw new Error("store needs a key and text");
          store(key, { name: str(request.name) || "attachment.txt", text: request.text });
          return { key };
        }
        case "admit": {
          const size = typeof request.size === "number" && Number.isFinite(request.size) ? request.size : 0;
          ports.admit({ name: str(request.name) || "attachment", mime: str(request.mime) || "application/octet-stream", size });
          return { ok: true };
        }
        case "upload": {
          const data = str(request.data);
          const file = { name: str(request.name) || "attachment", mime: str(request.mime) || "application/octet-stream" };
          // Refused on the encoded length, before a byte is decoded.
          ports.admit({ ...file, size: decodedLengthOf(data) });
          return ports.upload({ ...file, bytes: decodeBase64(data) });
        }
        case "sign": {
          const key = str(request.key);
          if (!key) throw new Error("sign needs a key");
          return ports.sign(key);
        }
        case "inline": {
          const list = Array.isArray(request.attachments) ? request.attachments : [];
          const attachments = list
            .filter((a): a is AttachmentRef => !!a && typeof (a as { key?: unknown }).key === "string")
            .map((a) => ({ key: a.key, ...(typeof a.name === "string" ? { name: a.name } : {}) }));
          return inline(attachments);
        }
        default:
          throw new Error(`Unsupported attachment operation ${JSON.stringify(request.op)}`);
      }
    },
  };
}
