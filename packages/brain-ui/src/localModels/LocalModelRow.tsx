/**
 * ONE on-device model in the picker — presentational. It renders a catalog row in its
 * state and reports intent; it holds no store and knows no host.
 *
 *   absent       → "Download (1.2 GB)"
 *   downloading  → a progress bar and Cancel
 *   ready        → selectable; Remove behind the overflow (⋯)
 *   unsupported  → inert, saying why in the host's words
 */
import { useState } from 'react';
import type { LocalModelRow as LocalModelRowData } from '@seanhogg/builderforce-brain-embedded';
import type { LocalModelLabels } from './labels';
import { fill } from '../spend/format';
import { formatDownloadSize, localModelMeta, progressPercent, unsupportedReason } from './localModelView';

export interface LocalModelRowProps {
  row: LocalModelRowData;
  labels: LocalModelLabels;
  /** This row is the pinned model. */
  active: boolean;
  /** Its last download failed. */
  failed?: boolean;
  /** BCP 47 locale for numbers; the runtime's when omitted. */
  locale?: string;
  onSelect(ref: string): void;
  onDownload(ref: string): void;
  onCancel(ref: string): void;
  onRemove(ref: string): void;
}

export function LocalModelRow({ row, labels, active, failed, locale, onSelect, onDownload, onCancel, onRemove }: LocalModelRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ready = row.state === 'ready';
  const percent = progressPercent(row);
  const meta = localModelMeta(row, labels, locale);

  return (
    <li className={`bf-lmodel${active ? ' is-active' : ''}${row.state === 'unsupported' ? ' is-unsupported' : ''}`} data-state={row.state}>
      <button
        type="button"
        className="bf-lmodel__main"
        disabled={!ready}
        aria-pressed={ready ? active : undefined}
        onClick={() => onSelect(row.ref)}
      >
        <span className="bf-lmodel__name">
          {row.label}
          {row.tools && <span className="bf-lmodel__badge">{labels.localTools}</span>}
        </span>
        <span className="bf-lmodel__meta">{meta}</span>
        {row.state === 'unsupported' && <span className="bf-lmodel__reason">{unsupportedReason(row, labels)}</span>}
        {failed && row.state === 'absent' && <span className="bf-lmodel__reason" role="alert">{labels.localDownloadFailed}</span>}
      </button>

      {row.state === 'absent' && (
        <button type="button" className="bf-lmodel__action" onClick={() => onDownload(row.ref)}>
          {fill(labels.localDownload, { size: formatDownloadSize(row.bytes, locale) })}
        </button>
      )}

      {row.state === 'downloading' && (
        <div className="bf-lmodel__progress">
          <div
            className="bf-lmodel__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={fill(labels.localDownloading, { percent })}
          >
            <span className="bf-lmodel__fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="bf-lmodel__pct">{fill(labels.localDownloading, { percent })}</span>
          <button type="button" className="bf-lmodel__action" onClick={() => onCancel(row.ref)}>
            {labels.localCancel}
          </button>
        </div>
      )}

      {ready && (
        <div className="bf-lmodel__more">
          <button
            type="button"
            className="bf-lmodel__kebab"
            aria-label={labels.localMoreActions}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <button
              type="button"
              className="bf-lmodel__action bf-lmodel__action--danger"
              onClick={() => {
                setMenuOpen(false);
                onRemove(row.ref);
              }}
            >
              {labels.localRemove}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
