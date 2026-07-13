'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import SectionTabs from './SectionTabs';
import TopBar from './TopBar';
import MobileBottomNav from './MobileBottomNav';
import EmulationBar from './EmulationBar';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import QaTelemetry from './QaTelemetry';
import { useEmulation } from '@/lib/EmulationContext';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';
import { useMobileNav } from '@/lib/useMobileNav';
import { NavCountsProvider } from '@/lib/navCounts';

function isProjectIdPage(pathname: string | null): boolean {
  return pathname != null && /^\/projects\/[^/]+$/.test(pathname);
}

function isIdePage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/ide/');
}

/** Deep full-screen routes (the IDE editor + a single project) render edge-to-edge
 *  with no section tab bar. The IDE launcher + Voice Studio still show tabs. */
function isFullScreenRoute(pathname: string | null): boolean {
  if (pathname == null) return false;
  if (isProjectIdPage(pathname)) return true;
  return /^\/ide\/(?!dashboard$|voice$)[^/]+/.test(pathname);
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
      <div
        className={`shell ${navCollapsed ? 'nav-collapsed' : ''}${emulation ? ' emulation-active' : ''}`}
        style={{ position: 'relative' }}
      >
        <TopBar onMenuClick={openNav} />
        <Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} mobileOpen={navOpen} onMobileClose={closeNav} />
        <NavCountsProvider>
          <main className="content" style={{ width: '100%', paddingLeft: 0 }}>
            {!isFullScreenRoute(pathname) && <SectionTabs />}
            {children}
          </main>
        </NavCountsProvider>
      </div>
      <MobileBottomNav />
    </div>
  );
}
