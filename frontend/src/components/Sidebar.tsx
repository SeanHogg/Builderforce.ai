'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenant } from '@/lib/auth';
import { isNavItemActive, type NavMatch } from '@/lib/nav';
import { PRODUCT_SECTIONS } from '@/lib/content';
import MascotIcon from './MascotIcon';
import SidebarLegalMenu from './legal/SidebarLegalMenu';

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
  { href: '/projects', label: 'Projects', icon: '▦', exactMatch: true },
  {
    href: '/ide/dashboard',
    label: 'IDE',
    icon: '💻',
    activePaths: ['/ide'],
  },
  { href: '/architect', label: 'Architect', icon: '🏛' },
  { href: '/workflows', label: 'Workflows', icon: '🔀', activePaths: ['/workflows'] },
  { href: '/tasks', label: 'Task Mgmt', icon: '☑' },
  { href: '/contributors', label: 'Contributors', icon: '📈' },
  { href: '/training', label: 'Training', icon: '🎓' },
];

const meshNav: NavItem[] = [
  { href: '/workforce', label: 'Workforce', icon: <MascotIcon size={20} /> },
  { href: '/chats', label: 'Chats', icon: '💬' },
];

const extensionsNav: NavItem[] = [
  { href: '/content-manager', label: 'Content Manager', icon: '✎' },
  { href: '/skills', label: 'Skills', icon: '⭐' },
  { href: '/personas', label: 'Personas', icon: '👤' },
  { href: '/prompts', label: 'Prompt Library', icon: '📚' },
];

const systemNav: NavItem[] = [
  { href: '/approvals', label: 'Approvals', icon: '✅' },
  { href: '/pricing', label: 'Pricing & Billing', icon: '💳' },
  { href: '/security', label: 'Security', icon: '🔒' },
  { href: '/settings', label: 'Settings', icon: '⚙', exactMatch: true },
  { href: '/settings/members', label: 'Members', icon: '👥' },
  { href: '/tenants', label: 'Tenant & Workspace', icon: '🏢' },
  { href: '/observability', label: 'Observability', icon: '📊' },
];

const adminNavItem: NavItem = { href: '/admin', label: 'Platform Admin', icon: '⚙', highlight: true };
const apiKeysNavItem: NavItem = { href: '/settings/api-keys', label: 'API Keys', icon: '🔑' };

/* ── Public (logged-out) marketing navigation ── */

const publicNav: NavItem[] = [
  { href: '/', label: 'Home', icon: '🏠', exactMatch: true },
  { href: '/product', label: 'Product', icon: '✨' },
  { href: '/marketplace', label: 'Workforce', icon: <MascotIcon size={20} /> },
  { href: '/agents', label: 'BuilderForce Agents', icon: '🤖' },
  { href: '/models', label: 'Models', icon: '🧠' },
  { href: '/blog', label: 'Blog', icon: '📝' },
  { href: '/pricing', label: 'Pricing', icon: '💳' },
];

// "What's inside" — the product capability groups, so logged-out visitors can
// see what the platform consists of right from the menu. Each links into the
// matching section of the /product tour.
const productNav: NavItem[] = PRODUCT_SECTIONS.map((s) => ({
  href: `/product#${s.id}`,
  label: s.title,
  icon: s.icon,
}));

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
            className={`nav-item ${active ? 'active' : ''} ${item.highlight ? 'nav-item-highlight' : ''} ${item.mobileOnly ? 'nav-item-mobile-only' : ''}`}
          >
            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && <span className="nav-item-label">{item.label}</span>}
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
 * The single primary navigation, auth-aware. Logged-out visitors get the public
 * marketing nav plus a "what's inside" product map and Sign in / Get started
 * CTAs; authenticated users get the full app workspace nav (admin/owner
 * sections self-gate). Visibility is decided here — no prop-drilled flags.
 *
 * Desktop: a docked rail (collapsible via the footer chevron). Mobile: an
 * off-canvas drawer opened from the TopBar hamburger, with a backdrop and an X
 * close button; tapping any link dismisses it.
 */
export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const path = pathname || '';
  const { isAuthenticated } = useAuth();

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
          {isAuthenticated ? (
            <>
              <div className="nav-section-label">MAIN</div>
              <NavSection items={mainNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
              <div className="nav-section-label">MESH</div>
              <NavSection items={meshNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
              <div className="nav-section-label">EXTENSIONS</div>
              <NavSection items={extensionsNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
              <div className="nav-section-label">SYSTEM</div>
              <NavSection items={systemNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
              <OwnerApiKeysNavItem collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
              <PlatformAdminNavSection collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
            </>
          ) : (
            <>
              <NavSection items={publicNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
              <div className="nav-section-label">What&apos;s inside</div>
              <NavSection items={productNav} collapsed={collapsed} pathname={path} onNavigate={onMobileClose} />
            </>
          )}
        </div>

        {/* Footer renders when it has content: the Sign in / Get started CTAs
            (logged out) and/or the legal menu (hidden on the collapsed rail).
            Skipping the empty case avoids a stray divider on the icon rail. */}
        {(!isAuthenticated || !collapsed) && (
          <div className="nav-footer">
            {!isAuthenticated && (
              <div className="nav-section" style={{ marginBottom: 0 }}>
                <Link href="/login" className="nav-item" onClick={onMobileClose}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🔑</span>
                  {!collapsed && <span className="nav-item-label">Sign In</span>}
                </Link>
                <Link
                  href="/register"
                  className="nav-item"
                  onClick={onMobileClose}
                  style={{
                    color: '#fff',
                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                    marginTop: 4,
                  }}
                >
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🚀</span>
                  {!collapsed && <span className="nav-item-label">Get Started</span>}
                </Link>
              </div>
            )}
            {/* Version + Terms/Privacy — relocated here from the old global footer
                (which overlapped page content); sits under the Get Started CTA. */}
            <SidebarLegalMenu collapsed={collapsed} />
          </div>
        )}
      </nav>
    </>
  );
}
