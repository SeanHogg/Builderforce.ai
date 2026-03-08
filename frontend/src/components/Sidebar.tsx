'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  activePaths?: string[];
}

const mainNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/projects', label: 'Projects', icon: '▦' },
  { href: '/tasks', label: 'Tasks', icon: '☑' },
  { href: '/brainstorm', label: 'Brain Storm', icon: '💡' },
  { href: '/ide', label: 'Code Editor', icon: '</>', activePaths: ['/ide', '/projects'] },
  { href: '/training', label: 'Training', icon: '🎓' },
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
  { href: '/pricing', label: 'Pricing & Billing', icon: '💳' },
  { href: '/security', label: 'Security', icon: '🔒' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
  { href: '/tenants', label: 'Tenant & Workspace', icon: '🏢' },
  { href: '/logs', label: 'Logs', icon: '📄' },
  { href: '/timeline', label: 'Timeline', icon: '📈' },
  { href: '/debug', label: 'Debug', icon: '🐛' },
];

function isActive(pathname: string, item: NavItem): boolean {
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
            className={`nav-item ${active ? 'active' : ''}`}
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
