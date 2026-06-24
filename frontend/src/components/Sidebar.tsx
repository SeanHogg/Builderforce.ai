'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenant } from '@/lib/auth';
import { isNavItemActive, type NavMatch } from '@/lib/nav';
import MascotIcon from './MascotIcon';
import SidebarLegalMenu from './legal/SidebarLegalMenu';
import UsageMeter from './UsageMeter';

interface NavItem extends NavMatch {
  label: string;
  icon: React.ReactNode;
  /** When true, use warning (yellow) color for this nav item */
  highlight?: boolean;
  /** When true, only show on mobile (hidden on desktop via CSS) */
  mobileOnly?: boolean;
}

/* ── Authenticated app navigation ── */

const mainNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/brainstorm', label: 'Brain Storm', icon: '💡' },
  { href: '/projects', label: 'Projects / Tasks', icon: '▦', activePaths: ['/tasks'] },
  {
    href: '/ide/dashboard',
    label: 'IDE',
    icon: '💻',
    activePaths: ['/ide'],
  },
  { href: '/ide/voice', label: 'Voice Studio', icon: '🎙', activePaths: ['/ide/voice'] },
  { href: '/workflows', label: 'Workflows', icon: '🔀', activePaths: ['/workflows'] },
];

const meshNav: NavItem[] = [
  // Chats and Approvals are consolidated into /workforce as tabs.
  { href: '/workforce', label: 'Workforce', icon: <MascotIcon size={20} /> },
  { href: '/ceremonies', label: 'Ceremonies', icon: '🎯' },
  { href: '/pmo', label: 'Portfolio (PMO)', icon: '📊' },
];

// Role-insight lenses. Pages self-gate via <RoleGate> (disable + "Requires <Role>"
// hint, never hidden), so every entry stays visible as an honest capability signal.
const insightsNav: NavItem[] = [
  { href: '/insights/engineering', label: 'AI Effectiveness', icon: '🤖', activePaths: ['/insights/engineering'] },
  { href: '/insights/dora', label: 'DORA', icon: '🚀', activePaths: ['/insights/dora'] },
  { href: '/insights/finance', label: 'FinOps', icon: '💰', activePaths: ['/insights/finance'] },
  { href: '/insights/funnel', label: 'Innovation Funnel', icon: '💡', activePaths: ['/insights/funnel'] },
  { href: '/insights/compliance', label: 'Compliance', icon: '🛡', activePaths: ['/insights/compliance'] },
];

const extensionsNav: NavItem[] = [
  { href: '/content-manager', label: 'Content Manager', icon: '✎' },
  { href: '/skills', label: 'Skills', icon: '⭐' },
  { href: '/personas', label: 'Personas', icon: '👤' },
  { href: '/prompts', label: 'Prompt Library', icon: '📚' },
];

const systemNav: NavItem[] = [
  { href: '/pricing', label: 'Pricing & Billing', icon: '💳' },
  { href: '/security', label: 'Security', icon: '🔒' },
  { href: '/settings', label: 'Settings', icon: '⚙', exactMatch: true },
  { href: '/tenants', label: 'Tenant & Workspace', icon: '🏢' },
];

const adminNavItem: NavItem = { href: '/admin', label: 'Platform Admin', icon: '⚙', highlight: true };
const apiKeysNavItem: NavItem = { href: '/settings/api-keys', label: 'API Keys', icon: '🔑' };

/** Renders the API Keys nav entry only for tenant owners. */
function OwnerApiKeysNavItem({ collapsed, pathname, onNavigate }: NavSectionWiring) {
  const tenant = getStoredTenant();
  if (tenant?.role !== 'owner') return null;
  return <NavSection items={[apiKeysNavItem]} collapsed={collapsed} pathname={pathname} onNavigate={onNavigate} />;
}

/** Renders the Platform Admin section only for superadmin users. */
function PlatformAdminNavSection({ collapsed, pathname, onNavigate }: NavSectionWiring) {
  const { user } = useAuth();
  if (!user?.isSuperadmin) return null;
  return (
    <>
      <div className="nav-section-label">ADMIN</div>
      <NavSection items={[adminNavItem]} collapsed={collapsed} pathname={pathname} onNavigate={onNavigate} />
    </>
  );
}

interface NavSectionWiring {
  collapsed: boolean;
  pathname: string;
  /** Called after a nav link is tapped (dismisses the mobile drawer). */
  onNavigate?: () => void;
}

function NavSection({ items, collapsed, pathname, onNavigate }: NavSectionWiring & { items: NavItem[] }) {
  return (
    <div className="nav-section">
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
            onClick={onNavigate}
            className={`nav-item ${active ? 'active' : ''} ${item.highlight ? 'nav-item-highlight' : ''} ${item.mobileOnly ? 'nav-item-mobile-only' : ''} flex items-center`}
            style={{ textAlign: 'left' }}
          >
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{item.icon}</span>
            {/* Always in the DOM so CSS owns visibility: hidden on the collapsed
                desktop rail (.nav.collapsed .nav-item-label), shown in the
                mobile drawer regardless of the desktop collapse preference. */}
            <span className="nav-item-label">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawer open state (ignored on desktop, where the rail is docked). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/**
 * The authenticated workspace navigation (admin/owner sections self-gate). This
 * rail is shown only to signed-in users; logged-out visitors get the horizontal
 * marketing header instead (MarketingHeader, via MarketingShell). Visibility is
 * decided here — no prop-drilled flags.
 *
 * Desktop: a docked rail (collapsible via the footer chevron). Mobile: an
 * off-canvas drawer opened from the TopBar hamburger, with a backdrop and an X
 * close button; tapping any link dismisses it.
 */
export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const path = pathname || '';

  return (
    <>
      <div
        className={`nav-backdrop${mobileOpen ? ' open' : ''}`}
        onClick={onMobileClose}
        aria-hidden="true"
      />
      <nav className={`nav ${collapsed ? 'collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        {/* Collapse handle — pinned top, bridging the right divider (desktop only) */}
        <button
          type="button"
          className="nav-collapse-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Mobile drawer header (hidden on desktop via CSS) */}
        <div className="nav-mobile-head">
          <span className="nav-mobile-title">Menu</span>
          <button type="button" className="nav-mobile-close" onClick={onMobileClose} aria-label="Close menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nav-main">
          <div className="nav-section-label">MAIN</div>
          <NavSection items={mainNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
          <div className="nav-section-label">MESH</div>
          <NavSection items={meshNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
          <div className="nav-section-label">INSIGHTS</div>
          <NavSection items={insightsNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
          <div className="nav-section-label">EXTENSIONS</div>
          <NavSection items={extensionsNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
          <div className="nav-section-label">SYSTEM</div>
          <NavSection items={systemNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
          <OwnerApiKeysNavItem collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
          <PlatformAdminNavSection collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
        </div>

        {/* Footer: the legal menu (hidden on the collapsed rail). Skipping the
            empty case avoids a stray divider on the icon rail. */}
        {!collapsed && (
          <div className="nav-footer">
            {/* Consumption meter (self-gates to signed-in tenants). */}
            <UsageMeter />
            {/* Version + Terms/Privacy — relocated here from the old global footer
                (which overlapped page content). */}
            <SidebarLegalMenu collapsed={collapsed} />
          </div>
        )}
      </nav>
    </>
  );
}