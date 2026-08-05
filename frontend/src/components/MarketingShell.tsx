'use client';

import { usePathname } from 'next/navigation';
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
  const pathname = usePathname() || '';
  // Anonymous Creation Sessions are full-screen application surfaces even though
  // they use the logged-out header. Keeping the marketing footer in this flex
  // column leaves `height: 100%` without a definite parent height on mobile, so
  // React Flow collapses to zero height (most visibly after a quota fallback
  // creates a local Session). Give the canvas the remaining viewport instead.
  const fullHeight = pathname.startsWith('/create/local-');

  return (
    <div className={`marketing-frame${fullHeight ? ' marketing-frame-full-height' : ''}`}>
      <MarketingHeader />
      <main id="main-content" className={`marketing-content${fullHeight ? ' marketing-content-full-height' : ''}`}>
        {children}
        {!fullHeight && <AppFooter variant="full" />}
      </main>
      <MobileBottomNav />
    </div>
  );
}
