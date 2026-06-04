'use client';

import Sidebar from './Sidebar';
import TopBar from './TopBar';
import AppFooter from './AppFooter';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';

/**
 * Shell for public marketing + browse pages. Reuses the same `.shell` grid +
 * Sidebar + TopBar as the app, but WITHOUT the OnboardingGate / emulation
 * chrome — so it renders for logged-out visitors (the gate returns null
 * pre-auth). The Sidebar and TopBar are auth-aware, so this one shell serves
 * both: marketing nav when logged out, app nav when signed in.
 */
export default function PublicShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapse();

  return (
    <>
      <div className={`shell ${collapsed ? 'nav-collapsed' : ''}`} style={{ position: 'relative' }}>
        <TopBar />
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggle} />
        <main className="content">{children}</main>
      </div>
      <AppFooter />
    </>
  );
}
