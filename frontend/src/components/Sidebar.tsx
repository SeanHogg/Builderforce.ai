'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { findActiveGroup, navGroupsForAccountType, type NavGroup } from '@/lib/navGroups';
import { useAvailableForHire, useIsFreelancer, useIsSalesAssociate } from '@/lib/rbac';
import { signInHref } from '@/lib/auth';
import { ButtonLink } from '@/components/ui';
import SidebarLegalMenu from './legal/SidebarLegalMenu';
import SessionList from './SessionList';
import UsageMeter from './UsageMeter';
import { NavIcon } from './navigation/NavIcon';
import { isStageRoute } from '@/lib/workbenchPolicy';

/**
 * The left panel (PRD 21 §3.2).
 *
 * It used to be a SITE MAP: `NAV_GROUPS` and nothing else, so the persistent
 * surface listed the product's departments and the person's own work appeared
 * nowhere. It now leads with **sessions** — New canvas, Active, Recents — and the
 * primary destinations follow underneath.
 *
 * The destinations stay because §3.2's "short object index" is only short if
 * everything it omits is reachable another way, and today the ⌘K palette is the
 * only other way in. Removing them would strand Insights, Growth, Reliability and
 * the rest behind a keystroke, which is not "the canvas is the front door" — it is
 * a product with hidden rooms. They are secondary here, not absent.
 *
 * Sub-views are NOT listed: they are their destination's index, rendered by the
 * shared <ShellIndex>. The Platform Admin destination self-gates to superadmins;
 * visibility is decided here — no prop-drilled flags.
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

function GroupLink({ group, active, onNavigate, t, badge = 0, locked = false, lockHint }: {
  group: NavGroup;
  active: boolean;
  onNavigate?: () => void;
  t: (k: string) => string;
  badge?: number;
  /** Renders visible and inert instead of navigating — see the note below. */
  locked?: boolean;
  lockHint?: string;
}) {
  const label = t(group.labelKey);
  const body = (
    <>
      <span className="nav-item-icon"><NavIcon name={group.id} /></span>
      <span className="nav-item-label">{label}</span>
      {locked && <span className="nav-item__lock" aria-hidden="true">🔒</span>}
      {!!badge && <span aria-label={`${badge} unread sessions`} style={{ marginLeft: 'auto', minWidth: 17, height: 17, borderRadius: 'var(--radius-full)', display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--text-on-accent)', fontSize: 'var(--font-size-field-label)', fontWeight: 800 }}>{badge > 99 ? '99+' : badge}</span>}
    </>
  );

  // Disable, never hide (PRD 21 §2.6 rule 7). A visitor with no account sees the
  // whole product's shape — what they cannot do yet reads as "not yet", not as
  // "this product does not do that". A `<span>` rather than a dimmed `<Link>`:
  // an anchor that looks disabled is still followable by keyboard and by
  // middle-click, so the state has to be the element, not a class on it.
  if (locked) {
    return (
      <span className="nav-item nav-item--locked flex items-center" aria-disabled="true" title={lockHint} data-label={label} data-tour={group.id}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={group.href}
      onClick={onNavigate}
      className={`nav-item ${active ? 'active' : ''} flex items-center`}
      style={{ textAlign: 'left' }}
      aria-current={active ? 'page' : undefined}
      data-label={label}
      // Stable anchor for the demo product tour (DemoTour) — the group id maps to
      // a TourAnchor. Inert outside a demo session.
      data-tour={group.id}
    >
      {body}
    </Link>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname() || '';
  const t = useTranslations('nav');
  const ts = useTranslations('sessions');
  const { user, isAuthenticated } = useAuth();

  const isFreelancer = useIsFreelancer();
  const availableForHire = useAvailableForHire();
  const isSales = useIsSalesAssociate();
  const allGroups = navGroupsForAccountType(isFreelancer, availableForHire, isSales);
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
          <span className="nav-collapse-tooltip" role="tooltip">
            {collapsed ? t('expandSidebar') : t('collapseSidebar')}
          </span>
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
          {/* The person's own work leads. Collapsed to the icon rail there is no
              room for titles, so the sessions fold away and the destinations
              stay — the rail is a way back to a place, not to a board. */}
          {!collapsed && <SessionList onNavigate={onMobileClose} />}
          <div className="nav-section">
            {!collapsed && <div className="ui-eyebrow nav-section__label">{t('workspaceLabel')}</div>}
            {groups.map((g) => (
              <GroupLink
                key={g.id}
                group={g}
                active={activeGroupId === g.id}
                onNavigate={onMobileClose}
                t={t}
                // A local Canvas is the product, not a teaser. Its destination
                // rail stays navigable while signed out; the destination's
                // durable Create/Save action owns the account gate. Outside a
                // Canvas, app destinations retain the normal auth boundary.
                locked={!isAuthenticated && !isStageRoute(pathname)}
              />
            ))}
          </div>
        </div>

        {!collapsed && (
          <div className="nav-footer">
            {/* The one thing a signed-out visitor's rail is missing: the way to
                keep what they are making. Their board is real and local-first,
                so this is an offer rather than a wall. */}
            {!isAuthenticated && (
              <ButtonLink href={signInHref(pathname)} variant="primary" size="sm" block>
                {ts('signInToKeep')}
              </ButtonLink>
            )}
            <UsageMeter />
            <SidebarLegalMenu collapsed={collapsed} />
          </div>
        )}
      </nav>
    </>
  );
}
