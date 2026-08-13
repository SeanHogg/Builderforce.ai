'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MarketingHeader from './MarketingHeader';
import MobileBottomNav from './MobileBottomNav';
import EmulationBar from './EmulationBar';
import BetaBanner from './beta/BetaBanner';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import QaTelemetry from './QaTelemetry';
import { useAuth } from '@/lib/AuthContext';
import { useEmulation } from '@/lib/EmulationContext';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';
import { useMobileNav } from '@/lib/useMobileNav';
import { NavCountsProvider } from '@/lib/navCounts';
import { ShellIndex } from './shell/ShellIndex';
import { ShellPanel } from './shell/ShellPanel';
import { TeamBar } from './team/TeamBar';
import LegalCorner from './legal/LegalCorner';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
// A reference page whose title is DATA (a diagnostic, named by the API catalog)
// tells the panel what to call it; the provider is the wire between them and has
// to sit above BOTH the panel and the page it frames.
import { ReferenceChromeProvider } from '@/lib/referenceChrome';
import { isStageRoute, panelOpen } from '@/lib/workbenchPolicy';

const CanvasStage = dynamic(
  () => import('./canvas/CanvasStage').then((module) => module.CanvasStage),
  { ssr: false },
);

function isProjectIdPage(pathname: string | null): boolean {
  return pathname != null && /^\/projects\/[^/]+$/.test(pathname);
}

/** A canvas ITSELF is full-screen. `/create` alone is now the canvas library — an
 *  ordinary scrolling page — so it must not be swept into the edge-to-edge case. */
function isCreationPage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/create/');
}

/** Deep full-screen routes render edge-to-edge with no index. */
function isFullScreenRoute(pathname: string | null): boolean {
  if (pathname == null) return false;
  if (isProjectIdPage(pathname)) return true;
  if (isCreationPage(pathname)) return true;
  return false;
}

/**
 * The shell (PRD 21 §3.1).
 *
 * Left panel: the person's SESSIONS. Centre: the board, mounted once and kept.
 * Footer: the TEAM — the always-on seats beside the humans you invited. Every
 * other destination arrives as a panel OVER the board rather than as a page that
 * replaces it, which is the one corollary the rest of the PRD is downstream of:
 * a route may change what is on screen, it may never unmount the stage.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { emulation } = useEmulation();
  const { isAuthenticated } = useAuth();

  // Project pages force icon-only mode; otherwise use the stored choice.
  // The collapsed rail keeps the canvas spacious, which §3.2 calls the default
  // posture for real work; expanding it reveals the session list and search.
  const routeCollapsed = isProjectIdPage(pathname);
  const { collapsed: navCollapsed, toggle: toggleNav } = useSidebarCollapse(routeCollapsed);
  const { open: navOpen, openNav, closeNav } = useMobileNav();

  // The board, if one is open. It is mounted HERE rather than by the route, so
  // opening a page no longer throws it away — see CanvasStage. Everyone who has
  // not opened a canvas pays nothing: `stageActive` is false and the layout below
  // is exactly what it always was.
  const canvas = useOptionalActiveCanvas();
  const stageActive = canvas?.active != null && canvas.stageHosted;
  const panelHosted = stageActive && panelOpen(pathname ?? '', true);
  const onStage = isStageRoute(pathname ?? '');

  return (
    <ReferenceChromeProvider>
    <div className="app-frame">
      <EmulationBar />
      {/* The open beta on offer, if this person has not answered it yet. In flow
          at the top of the frame so it pushes the shell down rather than covering
          the nav; it decides its own visibility and costs nothing otherwise. */}
      <BetaBanner />
      <PermissionDebuggerPanel />
      <QaTelemetry />
      <div
        className={`shell ${navCollapsed ? 'nav-collapsed' : ''}${emulation ? ' emulation-active' : ''}`}
        style={{ position: 'relative' }}
      >
        {/* One header per visitor, not one per shell.
            The operator shell is the SAME surface signed in or out (PRD 21 §0),
            and a guest reaches it from the marketing site — so arriving on a
            canvas used to replace the header they had just been navigating with
            a stub carrying a logo and a Marketplace link. Every way back into
            the product (Product, Learn, Features, Pricing) vanished at the exact
            moment somebody was deciding whether to sign up.
            So the header follows the VISITOR: `MarketingHeader` while signed
            out, `TopBar` once there is a session to switch scope, canvas and
            workspace in. Both render in the same grid area — see `.shell > .mh`.
            The marketing header owns its own mobile drawer, so the Sidebar's is
            handed over with it rather than left racing a second one open. */}
        {isAuthenticated ? <TopBar onMenuClick={openNav} /> : <MarketingHeader />}
        <Sidebar
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNav}
          mobileOpen={isAuthenticated && navOpen}
          onMobileClose={closeNav}
        />
        <NavCountsProvider>
          <main
            id="main-content"
            className={`content${stageActive ? ' app-full-height' : ''}`}
            style={{ width: '100%', paddingLeft: 0 }}
          >
            {stageActive ? (
              // Stage + panel. The board keeps its place in the tree in BOTH
              // states, which is the entire mechanism: React only preserves a
              // component that stays mounted at the same position, so the stage
              // must never be moved between branches to make room for a page.
              <div className="stage-split" data-panel={panelHosted ? 'open' : 'closed'}>
                <CanvasStage />
                {panelHosted ? (
                  <ShellPanel>
                    {children}
                  </ShellPanel>
                ) : (
                  // Either a stage route — whose page component renders nothing,
                  // it only registers the board — or a route that keeps the whole
                  // screen (the IDE, a project). Both want the page in flow beside
                  // the stage; neither is allowed to drop it.
                  <div className={onStage ? 'stage-split__registrar' : 'stage-split__full'}>
                    {!onStage && !isFullScreenRoute(pathname) && <ShellIndex />}
                    {children}
                  </div>
                )}
              </div>
            ) : (
              <>
                {!isFullScreenRoute(pathname) && <ShellIndex />}
                {children}
              </>
            )}
          </main>
        </NavCountsProvider>
      </div>
      {/* The team, always on the footer — §3.3. It decides its own visibility. */}
      <TeamBar />
      {/* Version + Terms/Privacy, in the frame's bottom-right corner. In flow as
          the last row, so it never covers the board or the roster above it. */}
      <LegalCorner />
      <MobileBottomNav />
    </div>
    </ReferenceChromeProvider>
  );
}
