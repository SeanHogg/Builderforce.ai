'use client';

/**
 * Inner sub-tab bar for a Platform Admin group (e.g. Users → Directory ·
 * Security · Emulation). Rendered by the admin page BELOW the shell's top
 * <SectionTabs> group bar; a pill/segmented look distinguishes it from the
 * underline top bar. Self-hides for single-sub groups (returns null) so the
 * caller never has to gate it.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { adminSubHref, type AdminGroupMeta } from '@/lib/adminGroups';

export default function AdminGroupNav({
  group,
  activeSubId,
}: {
  group: AdminGroupMeta;
  activeSubId: string;
}) {
  const t = useTranslations('admin');
  if (group.subs.length <= 1) return null;

  return (
    <nav
      aria-label={`${group.id} sub-views`}
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 20,
        paddingBottom: 4,
        overflowX: 'auto',
      }}
    >
      {group.subs.map((sub) => {
        const active = sub.id === activeSubId;
        return (
          <Link
            key={sub.subKey}
            href={adminSubHref(group.id, sub.id)}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              border: `1px solid ${active ? 'var(--border-accent, var(--accent))' : 'var(--border-subtle)'}`,
              background: active ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
              color: active ? 'var(--text-strong)' : 'var(--text-secondary)',
              transition: 'color .15s, background .15s, border-color .15s',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14 }}>{sub.icon}</span>
            <span>{t(`sub.${sub.subKey}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
