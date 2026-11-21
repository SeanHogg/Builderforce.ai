/**
 * A sent turn's attachments in the transcript: each picture as a thumbnail and each other
 * file as a chip — every one a button that opens THE attachment preview, with a download
 * of the original. Its own module so the message rows stay about messages.
 */
import { memo } from 'react';
import { AttachmentPreview } from '../attachments/AttachmentPreview';
import type { AttachmentPreviewLabels } from '../attachments/labels';
import type { AttachmentDownload, AttachmentPreviewItem } from '../attachments/types';
import { useAttachmentPreview } from '../attachments/useAttachmentPreview';
import { safeAttachmentUrl } from '../attachments/safeUrl';
import type { TimelineFile, TimelineImage } from '../timelineNodes';

/** A `blob:` URL dies with the page; a data URL or an account link is what a later open can still save. */
const durableUrl = (url: string | undefined): string | undefined => (url && !url.startsWith('blob:') ? url : undefined);

/**
 * What Download saves. An account or `data:` link wins — it is the file, and it survives a
 * reload. A `blob:` preview is only the fallback while that page still holds the file.
 */
export function attachmentDownloadUrl(href: string | undefined, preview: string | undefined): string | undefined {
  // Only an attachment's own schemes ever become a download target (`safeAttachmentUrl`).
  const link = safeAttachmentUrl(href);
  const copy = safeAttachmentUrl(preview);
  return durableUrl(link) ?? durableUrl(copy) ?? link ?? copy;
}

/** A picture: drawn from its stored copy, saved from its original link when there is one. */
const imageItem = (im: TimelineImage, fallbackName: string): AttachmentPreviewItem => ({
  name: im.name || fallbackName,
  ...(im.type ? { type: im.type } : {}),
  ...(im.key ? { key: im.key } : {}),
  ...(safeAttachmentUrl(im.url) ? { previewUrl: im.url } : {}),
  downloadUrl: attachmentDownloadUrl(im.href, im.url),
});

const fileItem = (f: TimelineFile): AttachmentPreviewItem => {
  const downloadUrl = attachmentDownloadUrl(f.href, undefined);
  return {
    name: f.name,
    ...(f.type ? { type: f.type } : {}),
    ...(f.key ? { key: f.key } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
};

function MessageAttachmentsInner({ images, files, labels, download }: {
  images: readonly TimelineImage[];
  files: readonly TimelineFile[];
  labels: AttachmentPreviewLabels;
  download?: AttachmentDownload;
}) {
  const imageFallbackName = labels.image;
  const preview = useAttachmentPreview();
  if (images.length === 0 && files.length === 0) return null;
  return (
    <>
      {images.length > 0 && (
        <div className="bf-tl__images">
          {images.map((im, i) => {
            const item = imageItem(im, imageFallbackName);
            return (
              <button
                key={i}
                type="button"
                className="bf-tl__image-btn"
                aria-haspopup="dialog"
                aria-label={`${labels.open}: ${item.name}`}
                title={item.name}
                onClick={(e) => preview.open(item, e.currentTarget)}
              >
                <img src={safeAttachmentUrl(im.url)} alt="" className="bf-tl__image" />
              </button>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="bf-tl__files">
          {files.map((f, i) => {
            const item = fileItem(f);
            return (
              <button
                key={i}
                type="button"
                className="bf-tl__file"
                aria-haspopup="dialog"
                aria-label={`${labels.open}: ${f.name}`}
                title={f.name}
                onClick={(e) => preview.open(item, e.currentTarget)}
              >
                <span className="bf-tl__file-name">{f.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <AttachmentPreview item={preview.item} onClose={preview.close} labels={labels} download={download} />
    </>
  );
}

export const MessageAttachments = memo(MessageAttachmentsInner);
