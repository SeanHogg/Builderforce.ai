import { browserDownload, dataCopyOf, safeAttachmentUrl, saveBlobAs, type AttachmentDownload } from '@seanhogg/builderforce-brain-ui';
import { fetchCanvasMediaBlob } from '@/lib/canvasMediaStore';
import { isAuthedMediaUrl } from '@/lib/loadAuthedImage';

/**
 * THE web's download port for brain-ui's attachment preview (`onDownloadAttachment` on the
 * transcript, `attachments.onDownload` on the composer). An uploaded file's link
 * (`/api/brain/uploads/<key>`) needs the app's bearer token, which a bare fetch or a new tab
 * cannot send — so it is read through the app's ONE authorized media fetch
 * (`fetchCanvasMediaBlob`, which also refuses a look-alike URL) and saved from the blob.
 * When that read fails, a picture's `data:` copy is saved instead; with none, the preview
 * says "Download failed". Every other link (a `blob:` / `data:` file on this device, a
 * signed or public URL) is the browser's own download.
 */
export const webAttachmentDownload: AttachmentDownload = async (item) => {
  const url = safeAttachmentUrl(item.downloadUrl);
  if (!url || !isAuthedMediaUrl(url)) return browserDownload(item);
  try {
    saveBlobAs(await fetchCanvasMediaBlob(url), item.name);
    return true;
  } catch {
    const copy = dataCopyOf(item);
    // No copy to fall back on: an empty message makes the preview say its own localized
    // "Download failed" instead of the fetch's English (`fetchCanvasMediaBlob` reports transport failures).
    if (!copy) throw new Error('');
    return browserDownload({ ...item, downloadUrl: copy });
  }
};
