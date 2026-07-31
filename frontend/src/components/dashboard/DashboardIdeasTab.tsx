'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useBrainChats } from '@/lib/brain';
import { useProjectScope } from '@/lib/ProjectScopeContext';

/**
 * Ideas / Brainstorm dashboard tab — a compact list of the tenant's Brain chats
 * that deep-links each row into the full brainstorm experience
 * (`/brainstorm?chat=<id>`). Reuses the same `useBrainChats` data layer the real
 * brainstorm page uses (the Brain providers wrap the whole app), so there's no
 * new fetch code and the list stays in sync with what /brainstorm shows.
 */
export function DashboardIdeasTab({ limit }: { limit?: number }) {
  const t = useTranslations('dashboard');
  const { currentProjectId } = useProjectScope();
  const chats = useBrainChats({ filterProjectId: currentProjectId != null ? String(currentProjectId) : null });

  if (chats.loading) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 0' }}>{t('ideas.loading')}</div>;
  }

  if (chats.chats.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-subtle)',
          borderRadius: 12,
          padding: '28px 16px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <p style={{ margin: '0 0 12px', fontSize: 14 }}>{t('ideas.empty')}</p>
        <Link
          href="/brainstorm"
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            borderRadius: 8,
            background: 'var(--coral-bright)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {t('ideas.start')}
        </Link>
      </div>
    );
  }

  const visible = limit != null ? chats.chats.slice(0, limit) : chats.chats;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {visible.map((c) => (
        <Link
          key={c.id}
          href={`/brainstorm?chat=${c.id}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '14px 16px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            background: 'var(--bg-elevated)',
            textDecoration: 'none',
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.title || t('ideas.untitled')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {new Date(c.updatedAt).toLocaleDateString()}
          </span>
        </Link>
      ))}
    </div>
  );
}
