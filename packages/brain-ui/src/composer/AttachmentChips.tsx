/**
 * Files waiting to go with the next message — removable until it is sent. A chip appears
 * the moment a file is attached, drawn from the file on this device while it uploads
 * (`status: 'uploading'`), and turns into the uploaded attachment, or into an error with
 * the reason (`status: 'error'`). Clicking one opens THE attachment preview.
 */
import { memo, useEffect } from 'react';
import { AttachmentPreview } from '../attachments/AttachmentPreview';
import type { AttachmentPreviewLabels } from '../attachments/labels';
import type { AttachmentDownload, AttachmentPreviewItem } from '../attachments/types';
import { useAttachmentPreview } from '../attachments/useAttachmentPreview';
import { safeAttachmentUrl } from '../attachments/safeUrl';
import type { ComposerLabels } from './labels';

export interface ComposerAttachment {
  key: string;
  name: string;
  /** A thumbnail for an image. */
  imageUrl?: string;
  /** MIME type and size in bytes, when known. */
  type?: string;
  size?: number;
  /** The ORIGINAL file on this device (an object URL) — the preview's picture and download. */
  localUrl?: string;
  /** Still uploading, or the upload failed (`error` says why). Absent ⇒ ready to send. */
  status?: 'uploading' | 'error';
  error?: string;
}

/** What the preview shows and saves for a chip: the original on this device first. */
export function chipPreviewItem(a: ComposerAttachment): AttachmentPreviewItem {
  const image = !!a.imageUrl || !!a.type?.startsWith('image/');
  const local = safeAttachmentUrl(a.localUrl);
  const stored = safeAttachmentUrl(a.imageUrl);
  const previewUrl = image ? (local ?? stored) : undefined;
  const downloadUrl = local ?? (image ? stored : undefined);
  return {
    key: a.key,
    name: a.name,
    ...(a.type ? { type: a.type } : {}),
    ...(a.size != null ? { size: a.size } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
}

function AttachmentChipsInner({ items, onRemove, labels, previewLabels, download, locale }: {
  items: readonly ComposerAttachment[];
  onRemove: (key: string) => void;
  labels: ComposerLabels;
  previewLabels: AttachmentPreviewLabels;
  /** Saves a chip's original from its preview; the browser's download when omitted. */
  download?: AttachmentDownload;
  locale?: string;
}) {
  const preview = useAttachmentPreview();
  // The chip behind an open preview changed: its upload landed (a new key, the same file on
  // this device) ⇒ show the uploaded one; it was removed or sent (its object URL revoked) ⇒ close.
  const openKey = preview.item?.key;
  const openLocal = preview.item?.downloadUrl;
  const { close, replace } = preview;
  useEffect(() => {
    if (openKey == null) return;
    if (items.some((a) => a.key === openKey)) return;
    const swapped = openLocal ? items.find((a) => a.localUrl && a.localUrl === openLocal) : undefined;
    if (swapped) replace(chipPreviewItem(swapped));
    else close();
  }, [items, openKey, openLocal, close, replace]);
  if (items.length === 0) return null;
  return (
    <div className="bf-cmp-attachments">
      {items.map((a) => {
        const thumb = safeAttachmentUrl(a.imageUrl ?? (a.type?.startsWith('image/') ? a.localUrl : undefined));
        const failed = a.status === 'error';
        return (
          <span
            key={a.key}
            className={`bf-cmp-chip${a.status ? ` bf-cmp-chip--${a.status}` : ''}`}
            aria-busy={a.status === 'uploading' || undefined}
          >
            <span className="bf-cmp-chip__row">
              <button
                type="button"
                className="bf-cmp-chip__open"
                aria-haspopup="dialog"
                aria-label={`${previewLabels.open}: ${a.name}`}
                title={a.name}
                onClick={(e) => preview.open(chipPreviewItem(a), e.currentTarget)}
              >
                {thumb && <img src={thumb} alt="" className="bf-cmp-chip__thumb" />}
                <span className="bf-cmp-chip__name">{a.name}</span>
              </button>
              {a.status === 'uploading' && (
                <span className="bf-cmp-chip__spinner" role="status" aria-label={labels.attachmentUploading} title={labels.attachmentUploading} />
              )}
              <button type="button" className="bf-cmp-chip__x" onClick={() => onRemove(a.key)} aria-label={`${labels.remove} ${a.name}`}>×</button>
            </span>
            {failed && <span className="bf-cmp-chip__error" role="alert">{a.error || labels.attachmentFailed}</span>}
          </span>
        );
      })}
      <AttachmentPreview item={preview.item} onClose={preview.close} labels={previewLabels} download={download} locale={locale} />
    </div>
  );
}

export const AttachmentChips = memo(AttachmentChipsInner);
