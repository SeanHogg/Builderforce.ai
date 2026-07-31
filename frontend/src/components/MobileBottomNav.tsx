'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
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
// Account-type aware so the bottom bar mirrors the correct shell:
//   - Builder (IDE creator):  Home / Projects / Workforce / Insights / account slot
//   - Job seeker (freelancer): Home / Profile / Marketplace / Timecard / account slot
// The final "account slot" is privilege-gated and shared by both bars (DRY): a
// platform superadmin gets Admin; everyone else gets their own account Settings
// (the "admin" of their own account) — we never surface a /admin link to a viewer
// who can't reach it. Labels are i18n keys, resolved by the component.
export function itemsFor(
  isAuthenticated: boolean,
  isSuperadmin: boolean,
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
  // Shared final slot: superadmins manage the platform (Admin), everyone else
  // manages their own account (Settings). One definition, used by both bars.
  const accountSlot: BottomItem = isSuperadmin
    ? { href: '/admin', labelKey: 'group.admin', icon: '⚙' }
    : { href: '/settings', labelKey: 'group.settings', icon: '⚙', exactMatch: true };
  // Job seeker (freelancer / gig account): the restricted for-hire shell — never
  // the builder app.
  if (isFreelancer) {
    return [
      { href: '/freelancer/dashboard', labelKey: 'tab.home', icon: '🏠' },
      { href: '/freelancer/profile', labelKey: 'group.myProfile', icon: '👤' },
      { href: '/marketplace', labelKey: 'group.marketplace', icon: <MascotIcon size={22} /> },
      { href: '/freelancer/timecard', labelKey: 'group.timecard', icon: '⏱' },
      accountSlot,
    ];
  }
  // Builder (IDE creator): the four primary work destinations + the account slot.
  return [
    { href: '/dashboard', labelKey: 'tab.home', icon: '🏠' },
    { href: '/projects', labelKey: 'group.projects', icon: '📁' },
    { href: '/workforce', labelKey: 'tab.workforce', icon: <MascotIcon size={22} /> },
    { href: '/insights', labelKey: 'group.insights', icon: '📈' },
    accountSlot,
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
  const items = itemsFor(isAuthenticated, !!user?.isSuperadmin, isFreelancer);

  return (
    <nav className="mobile-bottom-nav" aria-label={t('primaryAria')}>
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mbn-item${active ? ' active' : ''}${item.accent ? ' mbn-accent' : ''}`}
            aria-current={active ? 'page' : undefined}
            // Stable anchor for the demo product tour — first path segment matches
            // the sidebar nav ids / TourAnchor (e.g. /workforce → "workforce").
            data-tour={item.href.replace(/^\//, '').split('/')[0]}
          >
            <span className="mbn-icon" aria-hidden="true">{item.icon}</span>
            <span className="mbn-label">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
