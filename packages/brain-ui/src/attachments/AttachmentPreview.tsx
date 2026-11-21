/**
 * THE attachment preview — one panel for a picture or file attached to a turn or waiting
 * in the composer: the picture at a size that fits the viewport (or the file's name, type
 * and size), and a Download of the ORIGINAL through the host's port.
 *
 * A side panel that slides over the right edge (the project's slide-out convention; full
 * width on a narrow viewport), portalled to `document.body` so a scrolling transcript or a
 * clipped composer never cuts it. Escape, the close button or a click outside closes it,
 * and focus goes back to the trigger (`useAttachmentPreview`). Tab stays inside while open.
 *
 * It knows nothing about any host: the download is injected (`AttachmentDownload`), with
 * `browserDownload` as the default for the web.
 */
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { browserDownload } from './browserDownload';
import { safeAttachmentUrl } from './safeUrl';
import { attachmentPreviewLabels, type AttachmentPreviewLabels } from './labels';
import { isImageItem, type AttachmentDownload, type AttachmentPreviewItem } from './types';

export interface AttachmentPreviewProps {
  /** The open attachment; null renders nothing. */
  item: AttachmentPreviewItem | null;
  onClose: () => void;
  labels?: Partial<AttachmentPreviewLabels>;
  /** Saves the original; defaults to {@link browserDownload}. */
  download?: AttachmentDownload;
  /** For the file size's units. */
  locale?: string;
}

/** The file's size for the person, in their locale's units. */
export function formatFileSize(bytes: number, locale?: string): string {
  const [value, unit] = bytes >= 1024 * 1024
    ? [bytes / (1024 * 1024), 'megabyte']
    : bytes >= 1024 ? [bytes / 1024, 'kilobyte'] : [bytes, 'byte'];
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(value);
  } catch {
    return `${Math.round(value * 10) / 10} ${unit === 'megabyte' ? 'MB' : unit === 'kilobyte' ? 'KB' : 'B'}`;
  }
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

type DownloadStatus = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string };

function PreviewPanel({ item, onClose, labels, download, locale }: {
  item: AttachmentPreviewItem;
  onClose: () => void;
  labels: AttachmentPreviewLabels;
  download: AttachmentDownload;
  locale?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<DownloadStatus>({ kind: 'idle' });
  const [broken, setBroken] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => { closeRef.current?.focus(); }, []);
  // Escape closes from anywhere while the panel is open (the trigger lost focus to it).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const save = useCallback(async () => {
    setStatus({ kind: 'busy' });
    try {
      const saved = await download(item);
      if (alive.current) setStatus(saved === false ? { kind: 'idle' } : { kind: 'done' });
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : labels.downloadFailed;
      if (alive.current) setStatus({ kind: 'error', message });
    }
  }, [download, item, labels.downloadFailed]);

  const imageSrc = safeAttachmentUrl(item.previewUrl ?? (item.type?.startsWith('image/') ? item.downloadUrl : undefined));
  const showImage = isImageItem(item) && !!imageSrc && !broken;
  const meta = [item.type, item.size != null ? formatFileSize(item.size, locale) : null].filter(Boolean).join(' · ');
  const canDownload = !!item.downloadUrl;
  const note = status.kind === 'done' ? labels.downloaded
    : status.kind === 'error' ? status.message
      : canDownload ? '' : labels.unavailable;

  return (
    <div className="bf-attp" onMouseDown={onBackdrop}>
      <div
        ref={panelRef}
        className="bf-attp__panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${labels.dialog}: ${item.name}`}
        onKeyDown={trapTab}
      >
        <div className="bf-attp__head">
          <span className="bf-attp__title" title={item.name}>{item.name}</span>
          <button ref={closeRef} type="button" className="bf-attp__close" onClick={onClose} aria-label={labels.close} title={labels.close}>×</button>
        </div>
        <div className="bf-attp__body">
          {showImage
            ? <img src={imageSrc} alt={item.name} className="bf-attp__image" onError={() => setBroken(true)} />
            : (
              <div className="bf-attp__file">
                <span className="bf-attp__glyph" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                  </svg>
                </span>
                <span className="bf-attp__filename">{item.name}</span>
                <span className="bf-attp__hint">{labels.noPreview}</span>
              </div>
            )}
        </div>
        <div className="bf-attp__foot">
          <div className="bf-attp__info">
            {meta && <span className="bf-attp__meta">{meta}</span>}
            <span className={`bf-attp__note${status.kind === 'error' ? ' bf-attp__note--error' : ''}`} role="status" aria-live="polite">{note}</span>
          </div>
          <button
            type="button"
            className="bf-attp__download"
            onClick={() => { void save(); }}
            disabled={!canDownload || status.kind === 'busy'}
            aria-busy={status.kind === 'busy'}
          >
            {status.kind === 'busy' ? labels.downloading : labels.download}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentPreviewInner({ item, onClose, labels, download = browserDownload, locale }: AttachmentPreviewProps) {
  if (!item) return null;
  const panel = (
    <PreviewPanel
      // A different attachment starts with a fresh download state.
      key={`${item.key ?? ''}|${item.name}|${item.downloadUrl ?? item.previewUrl ?? ''}`}
      item={item}
      onClose={onClose}
      labels={attachmentPreviewLabels(labels)}
      download={download}
      locale={locale}
    />
  );
  return typeof document !== 'undefined' ? createPortal(panel, document.body) : panel;
}

export const AttachmentPreview = memo(AttachmentPreviewInner);
