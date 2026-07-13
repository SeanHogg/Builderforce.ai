'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { isNavItemActive, type NavMatch } from '@/lib/nav';
import MascotIcon from './MascotIcon';

interface BottomItem extends NavMatch {
  label: string;
  icon: ReactNode;
  /** Priority CTA treatment (e.g. Sign In when logged out). */
  accent?: boolean;
}

// Convention: "Home" is always first. Five high-traffic destinations; the full
// menu lives in the hamburger drawer. Uses the same isNavItemActive matcher as
// the Sidebar so both surfaces agree on active state.
function itemsFor(isAuthenticated: boolean, isSuperadmin: boolean): BottomItem[] {
  if (!isAuthenticated) {
    return [
      { href: '/', label: 'Home', icon: '🏠', exactMatch: true },
      { href: '/product', label: 'Product', icon: '✨' },
      { href: '/marketplace', label: 'Workforce', icon: <MascotIcon size={22} /> },
      { href: '/pricing', label: 'Pricing', icon: '💳' },
      { href: '/login', label: 'Sign In', icon: '🔑', accent: true },
    ];
  }
  const last: BottomItem = isSuperadmin
    ? { href: '/admin', label: 'Admin', icon: '⚙' }
    : { href: '/settings', label: 'Settings', icon: '⚙', exactMatch: true };
  return [
    { href: '/dashboard', label: 'Home', icon: '🏠' },
    { href: '/workforce', label: 'Workforce', icon: <MascotIcon size={22} /> },
    { href: '/workflows/builder', label: 'Workflows', icon: '🔀', activePaths: ['/workflows'] },
    { href: '/workforce?tab=chats', label: 'Chats', icon: '💬' },
    last,
  ];
}

/**
 * Persistent mobile-only bottom navigation (hidden ≥768px via CSS). Self-gating
 * and auth/role-aware — renders the right five destinations for the current
 * viewer with no props. Enhanced with better touch feedback and accessibility.
 */
export default function MobileBottomNav() {
  const pathname = usePathname() || '';
  const { isAuthenticated, user } = useAuth();
  const items = itemsFor(isAuthenticated, !!user?.isSuperadmin);

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
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
            <span className="mbn-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}