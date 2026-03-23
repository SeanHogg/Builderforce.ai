'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  activePaths?: string[];
  /** When true, only href exact match is active (no prefix match) */
  exactMatch?: boolean;
  /** When true, use warning (yellow) color for this nav item */
  highlight?: boolean;
  /** When true, only show on mobile (hidden on desktop via CSS) */
  mobileOnly?: boolean;
}

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
  { href: '/tasks', label: 'Task Mgmt', icon: '☑' },
  { href: '/training', label: 'Training', icon: '🎓' },
  { href: '/marketplace', label: 'Marketplace', icon: '🛒', mobileOnly: true },
];

const meshNav: NavItem[] = [
  { href: '/workforce', label: 'Workforce', icon: '👤' },
  { href: '/chats', label: 'Chats', icon: '💬' },
];

const extensionsNav: NavItem[] = [
  { href: '/content-manager', label: 'Content Manager', icon: '✎' },
  { href: '/skills', label: 'Skills', icon: '⭐' },
  { href: '/personas', label: 'Personas', icon: '👤' },
];

const systemNav: NavItem[] = [
  { href: '/approvals', label: 'Approvals', icon: '✅' },
  { href: '/pricing', label: 'Pricing & Billing', icon: '💳' },
  { href: '/security', label: 'Security', icon: '🔒' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
  { href: '/tenants', label: 'Tenant & Workspace', icon: '🏢' },
  { href: '/observability', label: 'Observability', icon: '📊' },
];

const adminNavItem: NavItem = { href: '/admin', label: 'Platform Admin', icon: '⚙', highlight: true };

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exactMatch) return pathname === item.href;
  if (pathname === item.href) return true;
  if (item.href !== '/dashboard' && pathname.startsWith(item.href)) return true;
  if (item.activePaths?.some((p) => pathname.startsWith(p))) return true;
  return false;
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
        const active = isActive(pathname, item);
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

export default function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const showAdmin = Boolean(user?.isSuperadmin);

  return (
    <nav className={`nav ${collapsed ? 'collapsed' : ''}`}>
      <div className="nav-main">
        <div className="nav-section-label">MAIN</div>
        <NavSection items={mainNav} collapsed={collapsed} pathname={pathname || ''} />
        <div className="nav-section-label">MESH</div>
        <NavSection items={meshNav} collapsed={collapsed} pathname={pathname || ''} />
        <div className="nav-section-label">EXTENSIONS</div>
        <NavSection items={extensionsNav} collapsed={collapsed} pathname={pathname || ''} />
        <div className="nav-section-label">SYSTEM</div>
        <NavSection items={systemNav} collapsed={collapsed} pathname={pathname || ''} />
        {showAdmin && (
          <>
            <div className="nav-section-label">ADMIN</div>
            <NavSection items={[adminNavItem]} collapsed={collapsed} pathname={pathname || ''} />
          </>
        )}
      </div>
      <div className="nav-footer">
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
