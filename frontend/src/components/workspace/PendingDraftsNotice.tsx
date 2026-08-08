'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { listPendingDrafts } from '@/lib/pendingWork';
import type { LocalCreationEntry } from '@/lib/creationSessions';

/**
 * Account-less boards still held in this browser, surfaced in the canvas library.
 *
 * The shell-level <ResumeWorkBridge> claims these automatically once a tenant
 * exists, so in the ordinary flow this renders nothing. It exists for the case
 * the bridge cannot cover: a claim that failed (offline, session quota reached)
 * would otherwise leave real work sitting in localStorage with no surface
 * admitting it is there. Self-gating — no pending drafts, no notice.
 */
export function PendingDraftsNotice() {
  const t = useTranslations('canvasLibrary');
  const [drafts, setDrafts] = useState<LocalCreationEntry[]>([]);

  useEffect(() => { setDrafts(listPendingDrafts()); }, []);

  if (drafts.length === 0) return null;

  return (
    <section
      aria-label={t('pendingTitle')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: 16, borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{t('pendingTitle')}</strong>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('pendingHint')}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {drafts.map((draft) => (
          <li key={draft.sessionId}>
            <Link
              href={`/create/${draft.sessionId}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                minHeight: 40, padding: '8px 14px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.88rem', fontWeight: 600,
              }}
            >
              <span aria-hidden="true">✦</span>
              {draft.title || t('untitled')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
