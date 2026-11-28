export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export function assetMaxBytes(mime: string): number {
  return mime.startsWith('video/') ? ASSET_MAX_VIDEO_BYTES : ASSET_MAX_BYTES;
}

/** Attachment previews can download any original the asset store admits. */
export const ATTACHMENT_DOWNLOAD_MAX_BYTES = ASSET_MAX_VIDEO_BYTES;
