'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { findActiveGroup, navGroupsForAccountType, type NavGroup } from '@/lib/navGroups';
import { useAvailableForHire, useIsFreelancer } from '@/lib/rbac';
import SidebarLegalMenu from './legal/SidebarLegalMenu';
import UsageMeter from './UsageMeter';

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

function GroupLink({ group, active, onNavigate, t }: {
  group: NavGroup;
  active: boolean;
  onNavigate?: () => void;
  t: (k: string) => string;
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
    </Link>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname() || '';
  const t = useTranslations('nav');
  const { user } = useAuth();

  const isFreelancer = useIsFreelancer();
  const availableForHire = useAvailableForHire();
  const allGroups = navGroupsForAccountType(isFreelancer, availableForHire);
  const activeGroupId = findActiveGroup(pathname)?.id
    ?? allGroups.find((g) => g.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)))?.id;
  const groups = allGroups.filter((g) => !g.superadminOnly || user?.isSuperadmin);

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
            {groups.map((g) => (
              <GroupLink key={g.id} group={g} active={activeGroupId === g.id} onNavigate={onMobileClose} t={t} />
            ))}
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
