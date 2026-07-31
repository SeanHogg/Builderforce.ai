'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MobileBottomNav from './MobileBottomNav';
import EmulationBar from './EmulationBar';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import QaTelemetry from './QaTelemetry';
import { useEmulation } from '@/lib/EmulationContext';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';
import { useMobileNav } from '@/lib/useMobileNav';

function isProjectIdPage(pathname: string | null): boolean {
  return pathname != null && /^\/projects\/[^/]+$/.test(pathname);
}

function isIdePage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/ide/');
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { emulation } = useEmulation();

  // IDE/project pages force icon-only mode; otherwise the user's stored choice.
  const routeCollapsed = isProjectIdPage(pathname) || isIdePage(pathname);
  const { collapsed: navCollapsed, toggle: toggleNav } = useSidebarCollapse(routeCollapsed);
  const { open: navOpen, openNav, closeNav } = useMobileNav();

  return (
    <div className="app-frame">
      <EmulationBar />
      <PermissionDebuggerPanel />
      <QaTelemetry />
      {/* `nav-collapsed` only narrows the docked desktop rail. Below 768px the
          rail column is 0px and the sidebar is an off-canvas drawer that always
          renders full-width labels, so the collapse preference is inert there —
          see the `.nav.mobile-open` rules in globals.css. Deciding this in CSS
          (not from `window.innerWidth` during render) keeps the server and
          client markup identical, so there is no hydration mismatch. */}
      <div
        className={`shell ${navCollapsed ? 'nav-collapsed' : ''}${emulation ? ' emulation-active' : ''}`}
        style={{ position: 'relative' }}
      >
        <TopBar onMenuClick={openNav} />
        <Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} mobileOpen={navOpen} onMobileClose={closeNav} />
        <main className="content">{children}</main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
