'use client';

import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MobileBottomNav from './MobileBottomNav';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';
import { useMobileNav } from '@/lib/useMobileNav';

/**
 * Shell for public marketing + browse pages. Reuses the same `.shell` grid +
 * Sidebar + TopBar as the app, but WITHOUT the OnboardingGate / emulation
 * chrome — so it renders for logged-out visitors (the gate returns null
 * pre-auth). The Sidebar and TopBar are auth-aware, so this one shell serves
 * both: marketing nav when logged out, app nav when signed in.
 *
 * Mobile: the Sidebar is an off-canvas drawer (hamburger in TopBar) and a
 * persistent bottom bar carries the high-traffic destinations.
 */
export default function PublicShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapse();
  const { open: navOpen, openNav, closeNav } = useMobileNav();

  return (
    <div className="app-frame">
      <div className={`shell ${collapsed ? 'nav-collapsed' : ''}`} style={{ position: 'relative' }}>
        <TopBar onMenuClick={openNav} />
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggle} mobileOpen={navOpen} onMobileClose={closeNav} />
        <main className="content">{children}</main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
