/**
 * The extension host's half of an attachment's DOWNLOAD (`attachment.download`): the
 * webview's attachment preview cannot save a file itself (a webview has no downloads, and
 * an account URL needs the extension's credential), so it asks the host, which resolves
 * the ORIGINAL's bytes and saves them where the person chooses.
 *
 * What the webview may send, and how each is resolved:
 *   • `url` on the BuilderForce origin, under an attachment path ({@link ATTACHMENT_PATHS}) —
 *     fetched with the extension's credential (an uploaded file). Any other origin or path is
 *     refused, so the credential only ever reads an attachment;
 *   • `url` that is a `data:` URL — decoded here (a picture kept inline);
 *   • `data` — the bytes, base64 (the webview read its own `blob:` URL: a file attached
 *     on this device). Over {@link ATTACHMENT_DOWNLOAD_MAX_BYTES} it is refused (the webview
 *     refuses first, before the bytes cross `postMessage`).
 *
 * Pure (no `vscode`): the network, the save dialog, the write and the person's sentences
 * are injected (`hostAttachmentDownload.ts` wires them).
 */

import { decodeBase64, decodedLengthOf } from "./attachmentIngress";
import { ATTACHMENT_DOWNLOAD_MAX_BYTES } from "./attachmentLimits";

/** The account paths an attachment is read from: an upload (credentialed) and its signed copy. */
export const ATTACHMENT_PATHS = ["/api/brain/uploads/", "/api/brain-files/"] as const;

/** What the webview sends. Untyped on purpose: it crossed a process boundary. */
export interface AttachmentDownloadRequest {
  name?: unknown;
  mime?: unknown;
  url?: unknown;
  data?: unknown;
}

export interface AttachmentDownloadPorts<Target> {
  /** The BuilderForce origin the credential belongs to (no trailing slash). */
  baseUrl(): string;
  /** GET `path` (an attachment path) on that origin with the credential, refusing redirects; throws the person's sentence. */
  fetchOwn(path: string, name: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Ask where to save `name`; undefined when the person cancelled. */
  chooseTarget(name: string): Promise<Target | undefined>;
  write(target: Target, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** The sentence for a file with no reachable copy. */
  unavailable(name: string): string;
  /** The sentence for a link that is not one of the account's attachments. */
  foreign(name: string): string;
  /** The sentence for a file over {@link ATTACHMENT_DOWNLOAD_MAX_BYTES}. */
  tooLarge(name: string): string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Names Windows reserves for devices, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A file name safe to offer in a save dialog: no folders, no characters or names a file system refuses. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  let clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
  clean = clean.slice(0, 200).replace(/[. ]+$/, "");
  if (!clean) return "attachment";
  return WINDOWS_RESERVED.test(clean) ? `_${clean}` : clean;
}

/** The bytes of a `data:` URL; null when it is not one or is malformed. */
export function dataUrlBytes(url: string): Uint8Array<ArrayBuffer> | null {
  const m = /^data:([^,]*?),(.*)$/s.exec(url);
  if (!m) return null;
  const meta = m[1] ?? "";
  const payload = m[2] ?? "";
  if (/;base64$/i.test(meta)) return decodeBase64(payload);
  try {
    return new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8"));
  } catch {
    // A malformed escape (`%E0%A4%A`): there is no file to save.
    return null;
  }
}

/** The attachment path of an account URL, or null when it is not one the credential may read. */
export function ownAttachmentPath(url: string, baseUrl: string): string | null {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin) return null;
  // No traversal out of the attachment path, however it is spelled.
  if (/\.\.|%2e|\\/i.test(url)) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  const path = parsed.pathname.startsWith(`${basePath}/`) ? parsed.pathname.slice(basePath.length) : null;
  if (!path || !ATTACHMENT_PATHS.some((p) => path.startsWith(p) && path.length > p.length)) return null;
  return `${path}${parsed.search}`;
}

async function bytesOf<T>(request: AttachmentDownloadRequest, name: string, ports: AttachmentDownloadPorts<T>): Promise<Uint8Array<ArrayBuffer>> {
  const data = str(request.data);
  if (data) {
    if (decodedLengthOf(data) > ATTACHMENT_DOWNLOAD_MAX_BYTES) throw new Error(ports.tooLarge(name));
    return decodeBase64(data);
  }
  const url = str(request.url);
  if (url.startsWith("data:")) {
    const bytes = dataUrlBytes(url);
    if (!bytes) throw new Error(ports.unavailable(name));
    return bytes;
  }
  if (/^https?:\/\//i.test(url)) {
    const path = ownAttachmentPath(url, ports.baseUrl());
    if (!path) throw new Error(ports.foreign(name));
    return ports.fetchOwn(path, name);
  }
  throw new Error(ports.unavailable(name));
}

/** Resolve the original and save it where the person chooses. `saved: false` = they cancelled. */
export async function downloadAttachment<T>(request: AttachmentDownloadRequest, ports: AttachmentDownloadPorts<T>): Promise<{ saved: boolean }> {
  const name = safeFileName(str(request.name));
  // Resolved BEFORE the dialog: a file that cannot be fetched says so instead of asking where to put it.
  const bytes = await bytesOf(request, name, ports);
  const target = await ports.chooseTarget(name);
  if (target === undefined) return { saved: false };
  await ports.write(target, bytes);
  return { saved: true };
}
