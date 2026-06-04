'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenant } from '@/lib/auth';
import { isNavItemActive, type NavMatch } from '@/lib/nav';
import { PRODUCT_SECTIONS } from '@/lib/content';

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
    href: '/ide',
    label: 'IDE',
    icon: '💻',
    activePaths: ['/ide'],
  },
  { href: '/architect', label: 'Architect', icon: '🏛' },
  { href: '/workflows/builder', label: 'Workflow Builder', icon: '🔀', activePaths: ['/workflows'] },
  { href: '/tasks', label: 'Task Mgmt', icon: '☑' },
  { href: '/contributors', label: 'Contributors', icon: '📈' },
  { href: '/training', label: 'Training', icon: '🎓' },
];

const meshNav: NavItem[] = [
  { href: '/workforce', label: 'Workforce', icon: '🦀' },
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
  { href: '/marketplace', label: 'Workforce', icon: '🦀' },
  { href: '/agents', label: 'BuilderForce Agents', icon: '🤖' },
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
function OwnerApiKeysNavItem({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  const tenant = getStoredTenant();
  if (tenant?.role !== 'owner') return null;
  return <NavSection items={[apiKeysNavItem]} collapsed={collapsed} pathname={pathname} />;
}

/** Renders the Platform Admin section only for superadmin users. */
function PlatformAdminNavSection({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  const { user } = useAuth();
  if (!user?.isSuperadmin) return null;
  return (
    <>
      <div className="nav-section-label">ADMIN</div>
      <NavSection items={[adminNavItem]} collapsed={collapsed} pathname={pathname} />
    </>
  );
}

function NavSection({
  items,
  collapsed,
  pathname,
}: {
  items: NavItem[];
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <div className="nav-section">
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
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
}

/**
 * The single primary navigation, auth-aware. Logged-out visitors get the public
 * marketing nav plus a "what's inside" product map and Sign in / Get started
 * CTAs; authenticated users get the full app workspace nav (admin/owner
 * sections self-gate). Visibility is decided here — no prop-drilled flags.
 */
export default function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const path = pathname || '';
  const { isAuthenticated } = useAuth();

  return (
    <nav className={`nav ${collapsed ? 'collapsed' : ''}`}>
      <div className="nav-main">
        {isAuthenticated ? (
          <>
            <div className="nav-section-label">MAIN</div>
            <NavSection items={mainNav} collapsed={collapsed} pathname={path} />
            <div className="nav-section-label">MESH</div>
            <NavSection items={meshNav} collapsed={collapsed} pathname={path} />
            <div className="nav-section-label">EXTENSIONS</div>
            <NavSection items={extensionsNav} collapsed={collapsed} pathname={path} />
            <div className="nav-section-label">SYSTEM</div>
            <NavSection items={systemNav} collapsed={collapsed} pathname={path} />
            <OwnerApiKeysNavItem collapsed={collapsed} pathname={path} />
            <PlatformAdminNavSection collapsed={collapsed} pathname={path} />
          </>
        ) : (
          <>
            <NavSection items={publicNav} collapsed={collapsed} pathname={path} />
            <div className="nav-section-label">What&apos;s inside</div>
            <NavSection items={productNav} collapsed={collapsed} pathname={path} />
          </>
        )}
      </div>

      <div className="nav-footer">
        {!isAuthenticated && (
          <div className="nav-section" style={{ marginBottom: 8 }}>
            <Link href="/login" className="nav-item">
              <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🔑</span>
              {!collapsed && <span className="nav-item-label">Sign In</span>}
            </Link>
            <Link
              href="/register"
              className="nav-item"
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
        <button
          type="button"
          className="nav-item"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
        >
          <span style={{ transform: collapsed ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>«</span>
          {!collapsed && <span className="nav-item-label">Minimize sidebar</span>}
        </button>
      </div>
    </nav>
  );
}
