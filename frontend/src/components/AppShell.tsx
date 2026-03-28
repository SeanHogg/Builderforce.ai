'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import AppFooter from './AppFooter';
import EmulationBar from './EmulationBar';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import { useEmulation } from '@/lib/EmulationContext';

const SIDEBAR_COLLAPSED_KEY = 'builderforce-sidebar-collapsed';

function isProjectIdPage(pathname: string | null): boolean {
  return pathname != null && /^\/projects\/[^/]+$/.test(pathname);
}

function isIdePage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/ide/');
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { emulation } = useEmulation();

  // User's manual collapse preference, initialised from localStorage at mount.
  // Route-forced collapse is computed below — never stored in state (avoids
  // calling setState synchronously inside an effect body).
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  // Derived — no state, no effect needed.
  const routeCollapsed = isProjectIdPage(pathname) || isIdePage(pathname);
  const navCollapsed = routeCollapsed || userCollapsed;

  // Sync localStorage when a route forces collapse. This is a side-effect on an
  // external system (localStorage), which is the intended use of useEffect.
  // No setState is called here, avoiding cascading renders.
  useEffect(() => {
    if (routeCollapsed && typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    }
  }, [routeCollapsed]);

  const toggleNav = useCallback(() => {
    const next = !userCollapsed;
    setUserCollapsed(next);
    if (typeof window !== 'undefined') localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
  }, [userCollapsed]);

  return (
    <>
      <EmulationBar />
      <PermissionDebuggerPanel />
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
