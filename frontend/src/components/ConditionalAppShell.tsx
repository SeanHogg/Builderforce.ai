'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';
import AppFooter from './AppFooter';
import PublicShell from './PublicShell';
import MarketingShell from './MarketingShell';
import OnboardingGate from './OnboardingGate';
import RouteMarketing from './RouteMarketing';
import { BrainActionsProvider, BrainContextProvider, BrainProvider, brainConfig, guestBrainConfig } from '@/lib/brain';
import { ReportErrorProvider } from './ReportErrorProvider';
import { GuestBrainstormPage } from './brain/GuestBrainstormPage';
import { PinsProvider } from '@/lib/widgets/PinsProvider';
import { AiInsightPanelProvider } from './insights/AiInsightPanelProvider';
import { AiInsightPanelBrainBridge } from './insights/AiInsightPanelBrainBridge';
import { DeliveryPanelProvider } from './insights/DeliveryPanelProvider';
import { DeliveryPanelBrainBridge } from './insights/DeliveryPanelBrainBridge';
import { FinancePanelProvider } from './insights/finance/FinancePanelProvider';
import { FinancePanelBrainBridge } from './insights/finance/FinancePanelBrainBridge';
import { WidgetBrainBridge } from './widgets/WidgetBrainBridge';
import { DevexPanelProvider } from './insights/DevexPanelProvider';
import { DevexPanelBrainBridge } from './insights/DevexPanelBrainBridge';
import { CanvasPanelProvider } from './canvas/CanvasPanelProvider';
import { CanvasPanelBrainBridge } from './canvas/CanvasPanelBrainBridge';
import { FloatingBrain } from './brain/FloatingBrain';
import { FeedbackTab } from './feedback/FeedbackTab';
import ActivityTracker from './ActivityTracker';
import { McpExtensionsBridge } from './brain/McpExtensionsBridge';
import { PlatformActionsBridge } from './brain/PlatformActionsBridge';
import { ProjectScopeProvider } from '@/lib/ProjectScopeContext';
import { useAuth } from '@/lib/AuthContext';
import { useIsFreelancer } from '@/lib/rbac';
import { findActiveGroup, isFreelancerAllowedPath } from '@/lib/navGroups';
import { classifyShell } from '@/lib/shellRouting';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { convertVisitor } from '@/lib/marketingApi';

/** Footer-only chrome for the standalone auth screens (login/register/activate). */
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
    // Guests can try the Brain/Ideas chat before signing up (top-of-funnel
    // adoption). On /brainstorm we render the guest chat in place of the marketing
    // teaser; it runs inside the guest-configured BrainProvider (see AppBrainShell).
    // Every other app route still shows the per-route teaser + login CTA.
    if (pathname.startsWith('/brainstorm')) {
      return (
        <MarketingShell>
          <GuestBrainstormPage />
        </MarketingShell>
      );
    }
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

/** Close anonymous Brain/tool attribution as soon as this browser authenticates. */
function MarketingConversionTracker() {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (isAuthenticated) convertVisitor();
  }, [isAuthenticated]);
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
  // in, the guest chat otherwise). See FloatingBrain.
  //
  // Logged-out visitors get the GUEST brain config (guest token + localStorage
  // persistence) so the Brain works anonymously with a tiny metered allowance;
  // signed-in users get the full tenant-authed config. Both are module constants,
  // so the provider's memoized runtime stays stable per auth state.
  return (
    // Global project scope wraps BOTH the shell content AND the FloatingBrain
    // launcher (a sibling of `content`). AppShell used to own this provider, but
    // the floating Brain drawer is mounted outside AppShell — so it read a null
    // scope and its chat history / new-chat scoping ignored the TopBar project
    // filter. Hoisting it here gives the switcher and the Brain ONE shared scope.
    <ProjectScopeProvider>
    <BrainProvider config={hasTenant ? brainConfig : guestBrainConfig}>
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
              <ReportErrorProvider>
              {content}
              <MarketingConversionTracker />
              <FreelancerRouteGuard />
              {/* Audited "click sense" capture — navigations + explicit signals
                  feed the billable-timecard pipeline. Signed-in users only. */}
              <ActivityTracker />
              {/* The Brain (launcher + capability/insight bridges) is a builder-app
                  surface — a freelancer/gig account never sees it. */}
              {showBrain && <FloatingBrain />}
              {/* Product feedback collector — this app dogfooding the embeddable
                  widget. Like the Brain it is a builder-app surface, and it
                  decides its own visibility from auth + project scope. */}
              {showBrain && <FeedbackTab />}
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
              {/* Widget tools: list_widgets / pin_widget / unpin_widget / show_widget
                  — let the Brain curate the user's pinnable home dashboard. */}
              {showBrain && <WidgetBrainBridge />}
              {/* Canvas slide-out tool: `show_canvas` lets the Brain generate a
                  visual board (notes/timers) and the user save it to Knowledge. */}
              {showBrain && <CanvasPanelBrainBridge />}
              </ReportErrorProvider>
            </BrainContextProvider>
          </BrainActionsProvider>
          </CanvasPanelProvider>
          </DevexPanelProvider>
          </FinancePanelProvider>
        </DeliveryPanelProvider>
      </AiInsightPanelProvider>
      </PinsProvider>
    </BrainProvider>
    </ProjectScopeProvider>
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
