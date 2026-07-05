'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';
import AppFooter from './AppFooter';
import PublicShell from './PublicShell';
import MarketingShell from './MarketingShell';
import OnboardingGate from './OnboardingGate';
import RouteMarketing from './RouteMarketing';
import { BrainActionsProvider, BrainContextProvider, BrainProvider, brainConfig } from '@/lib/brain';
import { PinsProvider } from '@/lib/widgets/PinsProvider';
import { AiInsightPanelProvider } from './insights/AiInsightPanelProvider';
import { AiInsightPanelBrainBridge } from './insights/AiInsightPanelBrainBridge';
import { DeliveryPanelProvider } from './insights/DeliveryPanelProvider';
import { DeliveryPanelBrainBridge } from './insights/DeliveryPanelBrainBridge';
import { FinancePanelProvider } from './insights/finance/FinancePanelProvider';
import { FinancePanelBrainBridge } from './insights/finance/FinancePanelBrainBridge';
import { DevexPanelProvider } from './insights/DevexPanelProvider';
import { DevexPanelBrainBridge } from './insights/DevexPanelBrainBridge';
import { CanvasPanelProvider } from './canvas/CanvasPanelProvider';
import { CanvasPanelBrainBridge } from './canvas/CanvasPanelBrainBridge';
import { FloatingBrain } from './brain/FloatingBrain';
import ActivityTracker from './ActivityTracker';
import { McpExtensionsBridge } from './brain/McpExtensionsBridge';
import { PlatformActionsBridge } from './brain/PlatformActionsBridge';
import { useAuth } from '@/lib/AuthContext';
import { useIsFreelancer } from '@/lib/rbac';
import { findActiveGroup, isFreelancerAllowedPath } from '@/lib/navGroups';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const FOOTER_ONLY_PATHS = ['/login', '/register'];

// Full-screen routes that render their own UI with no shell chrome.
const NO_CHROME_PREFIXES = ['/embed', '/webcontainer', '/auth/'];

// Marketing + public-browse routes. These render in PublicShell (auth-aware
// sidebar) for EVERYONE: logged-out visitors get the marketing nav + product
// map, signed-in users get the app nav — but the page stays publicly viewable.
// This is a DENY-LIST against the app shell: every route NOT listed here (nor
// no-chrome / footer-only) defaults to the authenticated app shell, so a new
// authed page gets correct chrome without being added to a list [1557]. Keep
// this list current as marketing/public routes are added.
const PUBLIC_SHELL_PREFIXES = ['/product', '/blog', '/agents', '/pricing', '/compare', '/marketplace', '/talent', '/prompts', '/models', '/integrations', '/diagnostics', '/tools', '/evermind', '/soc2'];

export type ShellKind = 'none' | 'footer' | 'public' | 'app';

/**
 * Classify the shell chrome for a path. Pure + exported for unit testing.
 * Order matters: no-chrome → footer-only → public-marketing → (default) app.
 * The app shell is the DEFAULT (deny-list model): anything not explicitly
 * no-chrome, footer-only, or public-marketing is treated as an authenticated
 * app route, so new pages get the right chrome by default [1557].
 */
export function classifyShell(pathname: string): ShellKind {
  if (NO_CHROME_PREFIXES.some((p) => pathname.startsWith(p))) return 'none';
  if (FOOTER_ONLY_PATHS.includes(pathname)) return 'footer';
  if (pathname === '/') return 'public';
  if (PUBLIC_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'public';
  return 'app';
}

/** Footer-only chrome for the auth screens (login/register). */
function FooterOnlyShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="layout-footer-only"
      style={{ height: '100vh', maxHeight: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {children}
      </div>
      <AppFooter />
    </div>
  );
}

/** Pick the shell chrome for the current route (Brain is mounted globally below). */
function useShellContent(children: React.ReactNode): React.ReactNode {
  const pathname = usePathname() || '';
  const { isAuthenticated } = useAuth();
  const isFreelancer = useIsFreelancer();

  const kind = classifyShell(pathname);
  if (kind === 'none') return <>{children}</>;
  if (kind === 'footer') return <FooterOnlyShell>{children}</FooterOnlyShell>;

  // Auth is the chrome switch: logged-out visitors get the marketing top-header
  // nav (MarketingShell); authenticated users keep the left Sidebar. This holds
  // for BOTH marketing/public-browse routes and logged-out hits on app routes.

  // Marketing + public browse.
  if (kind === 'public') {
    if (!isAuthenticated) return <MarketingShell>{children}</MarketingShell>;
    // A public route that is ALSO an in-app destination with sub-tabs (e.g.
    // /pricing is the Settings "Billing" tab) must keep the app's section-tab
    // bar for signed-in users — PublicShell drops it, so the in-page tab nav
    // vanished mid-flow. Render those in AppShell so the tabs persist (no
    // OnboardingGate — the page stays publicly viewable); other public-browse
    // routes (blog, marketplace, …) stay in PublicShell.
    const group = findActiveGroup(pathname);
    if (group?.tabs && group.tabs.length > 1) {
      return <AppShell>{children}</AppShell>;
    }
    return <PublicShell>{children}</PublicShell>;
  }

  // Default: authenticated app route. Logged out → a per-route marketing teaser
  // + login/CTA instead of a blank gate or redirect, so no authed deep link is
  // ever a dead end (the real page never mounts, so its own auth-redirect won't
  // fire). Signed in → AppShell behind the onboarding/terms gate.
  if (!isAuthenticated) {
    return (
      <MarketingShell>
        <RouteMarketing pathname={pathname} />
      </MarketingShell>
    );
  }
  // A freelancer/gig account may not view builder app routes. Render the shell WITHOUT
  // the page so the disallowed page never mounts (and never fires its tenant-scoped
  // fetches, which 401 for a tenantless account) — FreelancerRouteGuard redirects to
  // /freelancer/profile on the next tick.
  if (isFreelancer && !isFreelancerAllowedPath(pathname)) {
    return <AppShell>{null}</AppShell>;
  }
  return (
    <OnboardingGate renderShell={(gated) => <AppShell>{gated}</AppShell>}>
      {children}
    </OnboardingGate>
  );
}

/**
 * Lean provider tree for the `/embed/*` surface.
 *
 * The framed embed pages run inside a `credentialless`, cross-origin iframe — the
 * BuilderForce VS Code extension webview, or a third-party host (e.g. BurnRateOS).
 * The global Brain launcher + always-on network bridges that the full app tree
 * mounts app-wide — FloatingBrain (which also fires `pendingPromptsApi.claim()`
 * and mounts MigrationPanelHost portals), PlatformActionsBridge, McpExtensionsBridge,
 * and the five insights panel bridges — run effects/portals that throw or hang in
 * that partitioned webview context. An uncaught throw during the first render pass
 * unmounts the whole subtree (the root ErrorBoundary swallows it), so the framed
 * page never mounts and never posts `ready` → the host only sees a blank panel and
 * a 15s timeout. That failure is exactly why the Kanban board was moved to a native
 * webview panel (see boardPanel.ts); this restores the *rest* of the embed catalog
 * (roadmap, backlog, retros, poker, PRDs, ideas, trackers) by not mounting the
 * hostile globals in the frame. The resurfaced embed surfaces only ever consume the
 * Brain *context* providers (BrainPanel for `ideas`) and Pins (pinnable PM widgets),
 * never the global launcher — so mount just those. [native-board-vs-embed]
 */
function EmbedShell({ children }: { children: React.ReactNode }) {
  return (
    <BrainProvider config={brainConfig}>
      <PinsProvider>
        <BrainActionsProvider>
          <BrainContextProvider>{children}</BrainContextProvider>
        </BrainActionsProvider>
      </PinsProvider>
    </BrainProvider>
  );
}

/**
 * Redirects a freelancer/gig account away from any builder-app route they aren't
 * allowed to see (IDE, projects, insights, …) to their profile. Renders nothing —
 * the nav already hides those destinations; this closes deep links. Standard
 * accounts are unaffected.
 */
function FreelancerRouteGuard() {
  const isFreelancer = useIsFreelancer();
  const { isAuthenticated } = useAuth();
  const pathname = usePathname() || '';
  const router = useRouter();
  useEffect(() => {
    if (!isAuthenticated || !isFreelancer) return;
    if (classifyShell(pathname) === 'app' && !isFreelancerAllowedPath(pathname)) {
      router.replace('/freelancer/dashboard');
    }
  }, [isAuthenticated, isFreelancer, pathname, router]);
  return null;
}

function AppBrainShell({ children }: { children: React.ReactNode }) {
  const content = useShellContent(children);
  const { hasTenant } = useAuth();
  // Freelancers get the restricted shell: no global Brain launcher/bridges.
  const isFreelancer = useIsFreelancer();
  const showBrain = !isFreelancer;

  // The Brain (global AI assistant) is available on EVERY route — marketing,
  // blog, and app pages alike. The providers wrap the whole app so any page can
  // register actions / publish context; the floating launcher mounts once and
  // decides its own visibility and auth-gated content (full panel when signed
  // in, a sign-in CTA otherwise). See FloatingBrain.
  return (
    <BrainProvider config={brainConfig}>
      {/* App-wide pin state: any widget anywhere can show a pin control that
          reflects/updates the user's personal /insights home dashboard. */}
      <PinsProvider>
      {/* One app-wide AI Insights slide-out, opened by the combined /insights/ai
          dashboard AND by the Brain (via show_ai_insight → AiInsightPanelBrainBridge).
          Wraps the Brain providers so the bridge can reach the drawer. */}
      <AiInsightPanelProvider>
        <DeliveryPanelProvider>
          <FinancePanelProvider>
          <DevexPanelProvider>
          <CanvasPanelProvider>
          <BrainActionsProvider>
            <BrainContextProvider>
              {content}
              <FreelancerRouteGuard />
              {/* Audited "click sense" capture — navigations + explicit signals
                  feed the billable-timecard pipeline. Signed-in users only. */}
              <ActivityTracker />
              {/* The Brain (launcher + capability/insight bridges) is a builder-app
                  surface — a freelancer/gig account never sees it. */}
              {showBrain && <FloatingBrain />}
              {/* Make the Brain the epicenter for every action: register the platform
                  capability tools + the tenant's server-side MCP extension tools.
                  Both are auth-gated — they call the gateway with the tenant token. */}
              {showBrain && hasTenant && <PlatformActionsBridge />}
              {showBrain && hasTenant && <McpExtensionsBridge />}
              {/* Insights slide-out tools — register `show_ai_insight` +
                  `show_delivery_insight` so the Brain can surface insights in the
                  shared drawers. */}
              {showBrain && <AiInsightPanelBrainBridge />}
              {showBrain && <DeliveryPanelBrainBridge />}
              {showBrain && <FinancePanelBrainBridge />}
              {showBrain && <DevexPanelBrainBridge />}
              {/* Canvas slide-out tool: `show_canvas` lets the Brain generate a
                  visual board (notes/timers) and the user save it to Knowledge. */}
              {showBrain && <CanvasPanelBrainBridge />}
            </BrainContextProvider>
          </BrainActionsProvider>
          </CanvasPanelProvider>
          </DevexPanelProvider>
          </FinancePanelProvider>
        </DeliveryPanelProvider>
      </AiInsightPanelProvider>
      </PinsProvider>
    </BrainProvider>
  );
}

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  // `/embed` is framed cross-origin (VS Code webview / third-party host) and gets a
  // lean provider tree (no global Brain launcher/bridges) so a webview-hostile
  // global effect can't take the framed page down with it; every other route gets
  // the full app tree. Branch by delegating to distinct child components so neither
  // path ever calls the other's hooks conditionally (rules-of-hooks safe).
  const pathname = usePathname() || '';
  return pathname.startsWith('/embed') ? (
    <EmbedShell>{children}</EmbedShell>
  ) : (
    <AppBrainShell>{children}</AppBrainShell>
  );
}
