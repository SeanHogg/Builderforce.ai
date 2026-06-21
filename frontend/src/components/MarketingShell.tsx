'use client';

import MarketingHeader from './MarketingHeader';
import MobileBottomNav from './MobileBottomNav';
import AppFooter from './AppFooter';

/**
 * Shell for logged-out marketing / public-browse pages. The primary navigation
 * lives in a horizontal top header (MarketingHeader) rather than the left rail
 * — that's the homepage redesign: the menu moves to the header for every
 * marketing page, while authenticated users keep the left Sidebar (rendered by
 * PublicShell / AppShell instead — see ConditionalAppShell).
 *
 * Mobile keeps the persistent bottom bar for quick destinations, mirroring the
 * authenticated shells; the header hamburger opens the full menu drawer.
 */
export default function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-frame">
      <MarketingHeader />
      <main className="marketing-content">
        {children}
        <AppFooter variant="full" />
      </main>
      <MobileBottomNav />
    </div>
  );
}
