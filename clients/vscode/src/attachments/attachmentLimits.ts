/**
 * The attachment size ceilings — ONE copy, read by the extension host (`attachmentIngress.ts`,
 * `attachmentDownload.ts`) AND the webview (`webview/src/chat/attachmentDownload.ts`), so the
 * panel refuses an oversized file before it crosses `postMessage` with the same figure the
 * host enforces. No `vscode`, no other import: safe for both bundles.
 *
 * Mirrors `assetMaxBytes` in `api/src/application/assets/tenantAssetStore.ts` (held equal by
 * `attachmentLimits.test.ts`).
 */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export function uploadMaxBytes(mime: string): number {
  return mime.startsWith("video/") ? UPLOAD_MAX_VIDEO_BYTES : UPLOAD_MAX_BYTES;
}

/** The largest file a preview's Download moves: the largest the account stores. */
export const ATTACHMENT_DOWNLOAD_MAX_BYTES = UPLOAD_MAX_VIDEO_BYTES;
