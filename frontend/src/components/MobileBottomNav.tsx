'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenant } from '@/lib/auth';
import { useIsFreelancer } from '@/lib/rbac';
import { isNavItemActive, type NavMatch } from '@/lib/nav';
import MascotIcon from './MascotIcon';

interface BottomItem extends NavMatch {
  /** i18n key under the `nav` namespace (resolved in the component). */
  labelKey: string;
  icon: ReactNode;
  /** Priority CTA treatment (e.g. Sign In when logged out). */
  accent?: boolean;
}

// Convention (matches the reference): "Home" is always first. Five high-traffic
// destinations; the full menu lives in the hamburger drawer. Uses the same
// isNavItemActive matcher as the Sidebar so both surfaces agree on active state.
//
// Account-type aware, mirroring the sidebar's navGroupsForAccountType so the two
// surfaces never drift: a freelancer / gig ("job seeker") account sees the
// restricted for-hire destinations (Home / Find Work / Timecard / Profile /
// Security); a builder sees the builder destinations with a privilege-tuned last
// slot. Labels are i18n keys, resolved by the component.
export function itemsFor(
  isAuthenticated: boolean,
  isSuperadmin: boolean,
  role?: string,
  isFreelancer = false,
): BottomItem[] {
  if (!isAuthenticated) {
    return [
      { href: '/', labelKey: 'tab.home', icon: '🏠', exactMatch: true },
      { href: '/product', labelKey: 'bottom.product', icon: '✨' },
      { href: '/marketplace', labelKey: 'tab.workforce', icon: <MascotIcon size={22} /> },
      { href: '/pricing', labelKey: 'bottom.pricing', icon: '💳' },
      { href: '/login', labelKey: 'bottom.signIn', icon: '🔑', accent: true },
    ];
  }
  // Job seeker (freelancer / gig account): the restricted for-hire shell — never
  // the builder app. Mirrors FREELANCER_NAV_GROUPS (Dashboard / Profile / Find
  // Work / Timecard / Security) with Home first, so the bottom bar matches the
  // sidebar exactly.
  if (isFreelancer) {
    return [
      { href: '/freelancer/dashboard', labelKey: 'tab.home', icon: '🏠' },
      { href: '/freelancer/gigs', labelKey: 'group.findWork', icon: '🔎' },
      { href: '/freelancer/timecard', labelKey: 'group.timecard', icon: '⏱' },
      { href: '/freelancer/profile', labelKey: 'group.myProfile', icon: '👤' },
      { href: '/security', labelKey: 'tab.security', icon: '🔒' },
    ];
  }
  // Last slot is privilege-tuned [1335]: superadmins get Admin; workspace
  // managers (owner/manager — who actually use billing/members/keys) get
  // Settings; individual contributors (developer/viewer) get a work-focused
  // Projects entry instead, since Settings is rarely theirs.
  const canManage = role === 'owner' || role === 'manager';
  const last: BottomItem = isSuperadmin
    ? { href: '/admin', labelKey: 'group.admin', icon: '⚙' }
    : canManage
      ? { href: '/settings', labelKey: 'group.settings', icon: '⚙', exactMatch: true }
      : { href: '/projects', labelKey: 'group.projects', icon: '📁', activePaths: ['/projects'] };
  return [
    { href: '/dashboard', labelKey: 'tab.home', icon: '🏠' },
    { href: '/workforce', labelKey: 'tab.workforce', icon: <MascotIcon size={22} /> },
    { href: '/workflows/builder', labelKey: 'group.workflows', icon: '🔀', activePaths: ['/workflows'] },
    { href: '/workforce?tab=chats', labelKey: 'tab.chats', icon: '💬' },
    last,
  ];
}

/**
 * Persistent mobile-only bottom navigation (hidden ≥768px via CSS). Self-gating
 * and auth/account-type/role-aware — renders the right five destinations for the
 * current viewer with no props.
 */
export default function MobileBottomNav() {
  const pathname = usePathname() || '';
  const { isAuthenticated, user } = useAuth();
  const isFreelancer = useIsFreelancer();
  const t = useTranslations('nav');
  const items = itemsFor(isAuthenticated, !!user?.isSuperadmin, getStoredTenant()?.role, isFreelancer);

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mbn-item${active ? ' active' : ''}${item.accent ? ' mbn-accent' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mbn-icon" aria-hidden="true">{item.icon}</span>
            <span className="mbn-label">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
