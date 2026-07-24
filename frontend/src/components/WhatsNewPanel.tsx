'use client';

/**
 * "What's new" — the platform changelog, opened by clicking the version number
 * in the footer (and auto-opened by `?whatsnew=1`, the deep link the weekly
 * digest email's CTA uses). Renders the PUBLIC published release notes,
 * newest first, in the canonical SlideOutPanel.
 *
 * The list is fetched once per page lifetime (module-level promise cache):
 * the API side is already read-through-cached, this just avoids refetching on
 * every reopen of the panel.
 */

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { SlideOutPanel } from './SlideOutPanel';
import { fetchReleaseNotes, type ReleaseNote } from '@/lib/releaseNotesApi';

let notesPromise: Promise<ReleaseNote[]> | null = null;

function loadNotesOnce(): Promise<ReleaseNote[]> {
  if (!notesPromise) {
    notesPromise = fetchReleaseNotes().catch((err) => {
      notesPromise = null; // a failed load must not be cached forever
      throw err;
    });
  }
  return notesPromise;
}

/** Mid-tone accents read on BOTH themes; backgrounds derive from them via
 *  color-mix so no literal light-only/dark-only surface color exists here. */
const CATEGORY_ACCENT: Record<'new' | 'improvement' | 'fix', string> = {
  new: '#6366f1',
  improvement: '#10b981',
  fix: '#f59e0b',
};

function categoryKey(category: string): 'new' | 'improvement' | 'fix' {
  return category === 'new' || category === 'fix' ? category : 'improvement';
}

export default function WhatsNewPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('whatsNew');
  const locale = useLocale();
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || notes !== null) return;
    let cancelled = false;
    setError(false);
    loadNotesOnce()
      .then((loaded) => { if (!cancelled) setNotes(loaded); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [open, notes]);

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')}>
      {error ? (
        <p style={{ color: 'var(--text-secondary, #94a3b8)', padding: '8px 0' }}>{t('error')}</p>
      ) : notes === null ? (
        <p style={{ color: 'var(--text-secondary, #94a3b8)', padding: '8px 0' }}>{t('loading')}</p>
      ) : notes.length === 0 ? (
        <p style={{ color: 'var(--text-secondary, #94a3b8)', padding: '8px 0' }}>{t('empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {notes.map((note) => {
            const key = categoryKey(note.category);
            const accent = CATEGORY_ACCENT[key];
            return (
              <article
                key={note.id}
                style={{
                  borderBottom: '1px solid var(--border, #33415555)',
                  paddingBottom: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      borderRadius: 9999,
                      padding: '2px 10px',
                      color: accent,
                      background: `color-mix(in srgb, ${accent} 15%, transparent)`,
                    }}
                  >
                    {t(`categories.${key}`)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)', fontFamily: 'var(--mono, monospace)' }}>
                    v{note.version}
                  </span>
                  {note.publishedAt && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
                      {fmtDate(note.publishedAt)}
                    </span>
                  )}
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #e2e8f0)' }}>
                  {note.title}
                </h3>
                {(note.body ?? '')
                  .split(/\n{2,}/)
                  .map((para) => para.trim())
                  .filter(Boolean)
                  .map((para, i) => (
                    <p key={i} style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)' }}>
                      {para}
                    </p>
                  ))}
              </article>
            );
          })}
        </div>
      )}
    </SlideOutPanel>
  );
}
