'use client';

import { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import AppFooter from './AppFooter';

const SIDEBAR_COLLAPSED_KEY = 'builderforce-sidebar-collapsed';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(SIDEBAR_COLLAPSED_KEY) : null;
    setNavCollapsed(stored === '1');
  }, []);

  const toggleNav = useCallback(() => {
    const next = !navCollapsed;
    setNavCollapsed(next);
    if (typeof window !== 'undefined') localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
  }, [navCollapsed]);

  return (
    <>
      <div className={`shell ${navCollapsed ? 'nav-collapsed' : ''}`} style={{ position: 'relative' }}>
        <TopBar />
        <Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} />
        <main className="content">{children}</main>
      </div>
      <AppFooter />
    </>
  );
}
