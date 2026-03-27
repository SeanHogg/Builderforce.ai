'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import AppFooter from './AppFooter';
import EmulationBar from './EmulationBar';
import RolePreviewBar from './RolePreviewBar';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import { useEmulation } from '@/lib/EmulationContext';
import { useRolePreview } from '@/lib/RolePreviewContext';

const SIDEBAR_COLLAPSED_KEY = 'builderforce-sidebar-collapsed';

function isProjectIdPage(pathname: string | null): boolean {
  return pathname != null && /^\/projects\/[^/]+$/.test(pathname);
}

function isIdePage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/ide/');
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const { emulation } = useEmulation();
  const { previewRole } = useRolePreview();

  useEffect(() => {
    if (!pathname) return;
    if (isProjectIdPage(pathname) || isIdePage(pathname)) {
      setNavCollapsed(true);
      if (typeof window !== 'undefined') localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    } else {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(SIDEBAR_COLLAPSED_KEY) : null;
      setNavCollapsed(stored === '1');
    }
  }, [pathname]);

  const toggleNav = useCallback(() => {
    const next = !navCollapsed;
    setNavCollapsed(next);
    if (typeof window !== 'undefined') localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
  }, [navCollapsed]);

  return (
    <>
      <EmulationBar />
      <RolePreviewBar />
      <PermissionDebuggerPanel />
      <div
        className={`shell ${navCollapsed ? 'nav-collapsed' : ''}${emulation ? ' emulation-active' : ''}${previewRole && !emulation ? ' role-preview-active' : ''}`}
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
