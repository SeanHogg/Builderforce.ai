'use client';

/**
 * ONE comment thread, mountable anywhere (PRD 20 §7.1).
 *
 * `annotations` absorbs 33 tables — comments, notes, tags, likes, votes,
 * ratings, reactions — so this one component serves all seven kinds. The `kind`
 * prop is the discriminator, not a different component: a "like" is
 * `kind="like"` with `value=1`, which is why the platform did not need a
 * reactions surface as well as a comments surface.
 *
 * DECIDES ITS OWN VISIBILITY. Given no object it returns null; given no write
 * permission it renders read-only on its own authority rather than taking a
 * prop-drilled `canComment` the consumer would have to compute.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { addObjectAnnotation, getObjectAnnotations, type Annotation } from '@/lib/kernel/kernelApi';
import { useFormat } from "@/i18n/useFormat";

export function ObjectComments({
  objectId,
  kind = 'comment',
  limit = 50,
  locale = 'en',
}: {
  objectId?: string;
  /** 'comment' | 'note' | 'tag' | 'like' | 'vote' | 'rating' | 'reaction'. */
  kind?: string;
  limit?: number;
  locale?: string;
}) {
    const fmt = useFormat();
  const t = useTranslations('kernel.comments');
  const [rows, setRows] = useState<Annotation[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Set when the API refuses a write. Read-only is a STATE the component
   *  discovers, not a capability a caller asserts. */
  const [readOnly, setReadOnly] = useState(false);

  const load = useCallback(async () => {
    if (!objectId) return;
    try {
      setRows(await getObjectAnnotations(objectId, { kind, limit }));
    } catch {
      setRows([]);
    }
  }, [objectId, kind, limit]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    const body = draft.trim();
    if (!objectId || !body || busy) return;
    setBusy(true);
    try {
      const created = await addObjectAnnotation(objectId, { kind, body });
      setRows((prev) => [created, ...(prev ?? [])]);
      setDraft('');
    } catch {
      setReadOnly(true);
    } finally {
      setBusy(false);
    }
  };

  if (!objectId) return null;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {!readOnly && (
        <div className="flex flex-col gap-2">
          <label htmlFor="kernel-comment" className="sr-only">{t('placeholder')}</label>
          <textarea
            id="kernel-comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('placeholder')}
            rows={2}
            className="w-full rounded-md px-3 py-2 text-sm resize-y"
            style={{
              background: 'var(--surface)',
              color: 'var(--text-primary, var(--text-primary))',
              border: '1px solid var(--border-subtle, rgba(136,146,176,0.25))',
            }}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || draft.trim().length === 0}
              className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              {busy ? t('posting') : t('post')}
            </button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0 m-0 p-0 list-none">
          {rows.map((row) => (
            <li key={row.id} className="py-2.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {row.authorName ?? row.authorRef ?? t('someone')}
                </span>
                <time
                  dateTime={row.createdAt}
                  className="text-xs tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {fmt.dateTime(row.createdAt)}
                </time>
                {row.resolvedAt ? (
                  <span
                    className="text-[0.65rem] uppercase tracking-wider rounded px-1.5 py-0.5"
                    style={{ background: 'var(--success-bg, rgba(34,197,94,0.15))', color: 'var(--success, var(--success))' }}
                  >
                    {t('resolved')}
                  </span>
                ) : null}
              </div>
              {row.body ? (
                <p className="text-sm m-0 mt-1 break-words whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {row.body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
