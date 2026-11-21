/**
 * Files waiting to go with the next message — removable until it is sent. A chip appears
 * the moment a file is attached, drawn from the file on this device while it uploads
 * (`status: 'uploading'`), and turns into the uploaded attachment, or into an error with
 * the reason (`status: 'error'`). Clicking one opens THE attachment preview.
 */
import { memo } from 'react';
import { AttachmentPreview } from '../attachments/AttachmentPreview';
import type { AttachmentPreviewLabels } from '../attachments/labels';
import type { AttachmentDownload, AttachmentPreviewItem } from '../attachments/types';
import { useAttachmentPreview } from '../attachments/useAttachmentPreview';
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
  const previewUrl = image ? (a.localUrl ?? a.imageUrl) : undefined;
  const downloadUrl = a.localUrl ?? (image ? a.imageUrl : undefined);
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
  if (items.length === 0) return null;
  return (
    <div className="bf-cmp-attachments">
      {items.map((a) => {
        const thumb = a.imageUrl ?? (a.type?.startsWith('image/') ? a.localUrl : undefined);
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
