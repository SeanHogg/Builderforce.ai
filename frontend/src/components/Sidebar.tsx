'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { findActiveGroup, navGroupsForAccountType, type NavGroup } from '@/lib/navGroups';
import { useAvailableForHire, useIsFreelancer } from '@/lib/rbac';
import SidebarLegalMenu from './legal/SidebarLegalMenu';
import UsageMeter from './UsageMeter';
import { useEffect, useState } from 'react';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';

/**
 * The authenticated workspace navigation — a slim list of PRIMARY DESTINATIONS
 * (see lib/navGroups). Sub-views are NOT listed here; they are tabs inside their
 * destination, rendered by the shared <SectionTabs> bar in AppShell. The Platform
 * Admin destination self-gates to superadmins. Visibility is decided here — no
 * prop-drilled flags.
 *
 * Desktop: a docked rail (collapsible via the footer chevron). Mobile: an
 * off-canvas drawer opened from the TopBar hamburger.
 */

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function GroupLink({ group, active, onNavigate, t, badge = 0 }: {
  group: NavGroup;
  active: boolean;
  onNavigate?: () => void;
  t: (k: string) => string;
  badge?: number;
}) {
  return (
    <Link
      href={group.href}
      onClick={onNavigate}
      className={`nav-item ${active ? 'active' : ''} flex items-center`}
      style={{ textAlign: 'left' }}
      aria-current={active ? 'page' : undefined}
      // Stable anchor for the demo product tour (DemoTour) — the group id maps to
      // a TourAnchor. Inert outside a demo session.
      data-tour={group.id}
    >
      <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{group.icon}</span>
      <span className="nav-item-label">{t(group.labelKey)}</span>
      {!!badge && <span aria-label={`${badge} unread sessions`} style={{ marginLeft: 'auto', minWidth: 17, height: 17, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'white', fontSize: 9, fontWeight: 800 }}>{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname() || '';
  const t = useTranslations('nav');
  const { user } = useAuth();
  const [createSessions, setCreateSessions] = useState<Array<CreationSessionSummary & { matchingObjectId?: string | null }>>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionFilter, setSessionFilter] = useState('all');

  const isFreelancer = useIsFreelancer();
  const availableForHire = useAvailableForHire();
  const allGroups = navGroupsForAccountType(isFreelancer, availableForHire);
  const activeGroupId = findActiveGroup(pathname)?.id
    ?? allGroups.find((g) => g.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)))?.id;
  const groups = allGroups.filter((g) => !g.superadminOnly || user?.isSuperadmin);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const load = !collapsed && sessionSearch.trim().length >= 2 ? creationSessionsApi.search({ q: sessionSearch.trim(), limit: 30 }) : creationSessionsApi.list();
      void load.then(({ sessions }) => { if (active) setCreateSessions(sessions.slice(0, 12)); }).catch(() => undefined);
    }, sessionSearch ? 220 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [collapsed, pathname, sessionSearch, user]);
  const visibleCreateSessions = createSessions.filter((session) => {
    if (sessionFilter === 'mine') return session.role === 'owner';
    if (sessionFilter === 'shared') return (session.collaboratorCount ?? 1) > 1 && session.role !== 'owner';
    if (sessionFilter === 'project') return !!session.projectIds?.length;
    if (sessionFilter !== 'all') return session.preview?.kinds?.includes(sessionFilter);
    return true;
  });
  const unreadSessions = createSessions.filter((session) => session.unread).length;

  return (
    <>
      <div className={`nav-backdrop${mobileOpen ? ' open' : ''}`} onClick={onMobileClose} aria-hidden="true" />
      <nav className={`nav ${collapsed ? 'collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        <button
          type="button"
          className="nav-collapse-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          aria-expanded={!collapsed}
          title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Mobile drawer header (hidden on desktop via CSS) */}
        <div className="nav-mobile-head">
          <span className="nav-mobile-title">{t('menu')}</span>
          <button type="button" className="nav-mobile-close" onClick={onMobileClose} aria-label={t('closeMenu')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nav-main">
          <div className="nav-section">
            {groups.map((g) => <div key={g.id}>
              <GroupLink group={g} active={activeGroupId === g.id} onNavigate={onMobileClose} t={t} badge={g.id === 'create' ? unreadSessions : 0} />
              {g.id === 'create' && !collapsed && <div style={{ margin: '3px 5px 8px 34px', display: 'grid', gap: 3 }}>
                <Link href="/create/new" onClick={onMobileClose} style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', padding: '5px 6px' }}>+ New session</Link>
                <input aria-label="Search creation sessions" value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search sessions…" style={{ width: '100%', padding: '6px 7px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--text-primary)', font: 'inherit', fontSize: 11 }} />
                <select aria-label="Filter creation sessions" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} style={{ width: '100%', padding: '5px 6px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--text-secondary)', font: 'inherit', fontSize: 10 }}><option value="all">All sessions</option><option value="mine">Mine</option><option value="shared">Shared</option><option value="project">Project-backed</option><option value="workflow">Workflow</option><option value="website">Website</option><option value="dataset">Data</option><option value="llm">LLM</option><option value="voice">Voice</option></select>
                {visibleCreateSessions.slice(0, 7).map((session) => <Link key={session.id} href={`/create/${session.id}${session.matchingObjectId ? `?focus=${session.matchingObjectId}` : ''}`} onClick={onMobileClose} title={session.title} style={{ padding: '4px 6px', borderRadius: 5, color: pathname.includes(session.id) ? 'var(--accent)' : 'var(--text-secondary)', background: pathname.includes(session.id) ? 'var(--surface-subtle)' : 'transparent', textDecoration: 'none', fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.pinned ? '★ ' : ''}{session.title}{session.unread ? ' ·' : ''}</Link>)}
              </div>}
            </div>)}
          </div>
        </div>

        {!collapsed && (
          <div className="nav-footer">
            <UsageMeter />
            <SidebarLegalMenu collapsed={collapsed} />
          </div>
        )}
      </nav>
    </>
  );
}
