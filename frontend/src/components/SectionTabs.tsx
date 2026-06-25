'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getStoredTenant } from '@/lib/auth';
import { findActiveGroup, activeRouteTabId, tabHref, type NavTab } from '@/lib/navGroups';

/**
 * The one tab bar for the whole app. It self-decides from the route which
 * primary destination is active and renders that destination's sub-views as
 * tabs (so sub-views are tabs, never their own menu item). Renders nothing for
 * destinations with no sub-tabs (Dashboard, Brain Storm, Workflows) or that own
 * a richer in-page bar (Workforce). Owner-only tabs (e.g. API Keys) are hidden
 * from non-owners, matching the prior sidebar behavior.
 */

const barStyle: CSSProperties = {
  display: 'flex', gap: 2, padding: '0 16px', borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
};
const innerStyle: CSSProperties = { display: 'flex', gap: 2, maxWidth: 1200, margin: '0 auto', width: '100%' };

function tabStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 14px', fontSize: 13,
    fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none',
    color: active ? 'var(--text-strong)' : 'var(--text-secondary)',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    marginBottom: -1, transition: 'color .15s, border-color .15s',
  };
}

export default function SectionTabs() {
  const t = useTranslations('nav');
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();

  const group = findActiveGroup(pathname);
  if (!group || !group.tabs || group.tabs.length === 0) return null;

  const isOwner = getStoredTenant()?.role === 'owner';
  const tabs = group.tabs.filter((tab) => !tab.ownerOnly || isOwner);
  if (tabs.length <= 1) return null;

  const activeId = group.tabKind === 'query'
    ? (searchParams.get('tab') ?? '')
    : activeRouteTabId(group, pathname);

  const isActive = (tab: NavTab) => tab.id === activeId;

  return (
    <nav style={barStyle} aria-label={t(group.labelKey)}>
      <div style={innerStyle}>
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <Link
              key={tab.id || 'default'}
              href={tabHref(group, tab)}
              style={tabStyle(active)}
              aria-current={active ? 'page' : undefined}
            >
              <span aria-hidden="true" style={{ fontSize: 15 }}>{tab.icon}</span>
              <span>{t(tab.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
