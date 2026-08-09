'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MobileBottomNav from './MobileBottomNav';
import EmulationBar from './EmulationBar';
import PermissionDebuggerPanel from './PermissionDebuggerPanel';
import QaTelemetry from './QaTelemetry';
import { useEmulation } from '@/lib/EmulationContext';
import { useSidebarCollapse } from '@/lib/useSidebarCollapse';
import { useMobileNav } from '@/lib/useMobileNav';
import { NavCountsProvider } from '@/lib/navCounts';
import { CanvasStage } from './canvas/CanvasStage';
import { ShellIndex } from './shell/ShellIndex';
import { ShellPanel } from './shell/ShellPanel';
import { TeamBar } from './team/TeamBar';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { isStageRoute, panelOpen } from '@/lib/workbenchPolicy';

function isProjectIdPage(pathname: string | null): boolean {
  return pathname != null && /^\/projects\/[^/]+$/.test(pathname);
}

function isIdePage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/ide/');
}

/** A canvas ITSELF is full-screen. `/create` alone is now the canvas library — an
 *  ordinary scrolling page — so it must not be swept into the edge-to-edge case. */
function isCreationPage(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith('/create/');
}

/** Deep full-screen routes (the IDE editor + a single project) render edge-to-edge
 *  with no index. The IDE launcher + Voice Studio still show theirs. */
function isFullScreenRoute(pathname: string | null): boolean {
  if (pathname == null) return false;
  if (isProjectIdPage(pathname)) return true;
  if (isCreationPage(pathname)) return true;
  return /^\/ide\/(?!dashboard$|voice$)[^/]+/.test(pathname);
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

  // IDE/project pages force icon-only mode; otherwise the user's stored choice.
  // The collapsed rail keeps the canvas spacious, which §3.2 calls the default
  // posture for real work; expanding it reveals the session list and search.
  const routeCollapsed = isProjectIdPage(pathname) || isIdePage(pathname);
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
      <MobileBottomNav />
    </div>
  );
}
