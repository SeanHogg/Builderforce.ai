/** What the attachment preview shows and saves — shared by the transcript and the composer. */
export interface AttachmentPreviewItem {
  name: string;
  /** MIME type, when known. */
  type?: string;
  /** Size in bytes, when known. */
  size?: number;
  /** What the panel draws for a picture (may be a reduced copy). */
  previewUrl?: string;
  /** The ORIGINAL file — what Download saves. Omitted when no copy is reachable. */
  downloadUrl?: string;
  /** The attachment's key, for a host that resolves the original by it. */
  key?: string;
}

/**
 * Saves an attachment for the person. Resolves `false` when they cancelled (no message),
 * anything else when it was saved; throws an Error whose message is the person's sentence.
 * Injected by the host: a VS Code webview routes it through the extension, the web app
 * uses `browserDownload`.
 */
export type AttachmentDownload = (item: AttachmentPreviewItem) => Promise<boolean | void>;

export const isImageItem = (item: Pick<AttachmentPreviewItem, 'type' | 'previewUrl'>): boolean =>
  !!item.previewUrl || !!item.type?.startsWith('image/');
