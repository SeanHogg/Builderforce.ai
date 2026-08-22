'use client';

/**
 * Attachments on a posting or a proposal.
 *
 * ── ONE COMPONENT, TWO SIDES ────────────────────────────────────────────────────
 * A client's brief and a bidder's work sample are the same list of the same shape stored
 * in the same bucket, so they are one component that is handed an opener, an uploader and
 * a remover. Two near-identical panels is how one side quietly grows a size limit or a
 * delete confirmation the other never gets.
 *
 * ── WHY OPENING IS A FETCH AND NOT AN href ─────────────────────────────────────
 * The attachment endpoints are authenticated, and a plain `<a href>` carries no Bearer
 * token — it would 401 for exactly the people entitled to the file. So `onOpen` fetches
 * through the same transport as every other call and hands back an object URL, which this
 * component opens and then REVOKES. There is no direct-to-bucket URL anywhere in the flow:
 * the R2 key is a name, not a credential, and handing one to the browser would make it one.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { formatBytes } from './jobVocabulary';
import type { PostingAttachment } from '@/lib/freelance/postings';

export function AttachmentsPanel({
  attachments,
  readOnly = false,
  onOpen,
  onUpload,
  onRemove,
  max = 10,
}: {
  attachments: PostingAttachment[];
  /** A viewer who may look but not change — a bidder reading the client's brief. */
  readOnly?: boolean;
  /** Fetches the bytes (with the caller's token) and resolves an object URL. */
  onOpen: (attachmentId: string) => Promise<string>;
  onUpload?: (file: File) => Promise<void>;
  onRemove?: (attachmentId: string) => Promise<void>;
  max?: number;
}) {
  const t = useTranslations('freelancer');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : t('jobs.attachFailed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {attachments.length === 0 && readOnly ? null : (
        <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          {t('jobs.attachments')}
        </div>
      )}

      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0,
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '6px 10px',
          }}
        >
          <Icon name="attachment" size={14} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => {
              const url = await onOpen(attachment.id);
              window.open(url, '_blank', 'noopener');
              // The blob is held only long enough for the new context to take it; leaving
              // it attached would keep the whole file in memory for the page's lifetime.
              window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            })}
            style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {attachment.name}
          </button>
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{formatBytes(attachment.size)}</span>
          {!readOnly && onRemove && (
            <button
              type="button"
              disabled={busy}
              aria-label={t('jobs.attachRemove')}
              onClick={() => void run(() => onRemove(attachment.id))}
              style={{
                marginLeft: 'auto', border: 'none', background: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      ))}

      {!readOnly && onUpload && attachments.length < max && (
        <>
          <input
            ref={inputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void run(() => onUpload(file));
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            style={{
              alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--border-subtle)', background: 'transparent',
              color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {busy ? t('jobs.attaching') : t('jobs.attachAdd')}
          </button>
        </>
      )}

      {error && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--coral-bright)' }}>{error}</div>}
    </div>
  );
}
