'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import AppFooter from './AppFooter';
import EmulationBar from './EmulationBar';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import QaTelemetry from './QaTelemetry';
import { useEmulation } from '@/lib/EmulationContext';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';

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

  return (
    <>
      <EmulationBar />
      <PermissionDebuggerPanel />
      <QaTelemetry />
      <div
        className={`shell ${navCollapsed ? 'nav-collapsed' : ''}${emulation ? ' emulation-active' : ''}`}
        style={{ position: 'relative' }}
      >
        <TopBar />
        <Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} />
        <main className="content">{children}</main>
      </div>
      <AppFooter />
    </>
  );
}
