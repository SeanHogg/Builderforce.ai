'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import AppShell from './AppShell';
import AppFooter from './AppFooter';
import PublicShell from './PublicShell';
import MarketingShell from './MarketingShell';
import OnboardingGate from './OnboardingGate';
import RouteMarketing from './RouteMarketing';
import { BrainActionsProvider, BrainContextProvider, BrainProvider, brainConfig, guestBrainConfig } from '@/lib/brain';
import { ReportErrorProvider } from './ReportErrorProvider';
import { PinsProvider } from '@/lib/widgets/PinsProvider';
import { AiInsightPanelProvider } from './insights/AiInsightPanelProvider';
import { AiInsightPanelBrainBridge } from './insights/AiInsightPanelBrainBridge';
import { DeliveryPanelProvider } from './insights/DeliveryPanelProvider';
import { DeliveryPanelBrainBridge } from './insights/DeliveryPanelBrainBridge';
import { FinancePanelProvider } from './insights/finance/FinancePanelProvider';
import { FinancePanelBrainBridge } from './insights/finance/FinancePanelBrainBridge';
import { WidgetBrainBridge } from './widgets/WidgetBrainBridge';
import { DestinationBrainBridge } from './workspace/DestinationBrainBridge';
import { DevexPanelProvider } from './insights/DevexPanelProvider';
import { DevexPanelBrainBridge } from './insights/DevexPanelBrainBridge';
import { CanvasPanelBrainBridge } from './canvas/CanvasPanelBrainBridge';
import { FloatingBrain } from './brain/FloatingBrain';
import { GuestBrainPanel } from './brain/GuestBrainPanel';
import { FeedbackTab } from './feedback/FeedbackTab';
import ActivityTracker from './ActivityTracker';
import { McpExtensionsBridge } from './brain/McpExtensionsBridge';
import { PlatformActionsBridge } from './brain/PlatformActionsBridge';
import { ProjectScopeProvider } from '@/lib/ProjectScopeContext';
import { useAuth } from '@/lib/AuthContext';
import { useIsFreelancer, useIsSalesAssociate } from '@/lib/rbac';
import { findActiveGroup, isFreelancerAllowedPath, isSalesAllowedPath } from '@/lib/navGroups';
import { classifyGuestBrainstormEntry, classifyShell, isFramedEmbed, isReferenceSurface, rendersAppShell } from '@/lib/shellRouting';
import { rendersOperatorShell } from '@/lib/workbenchPolicy';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { convertVisitor } from '@/lib/marketingApi';
import { claimGuestRoomIntoAccount } from '@/lib/guestRoomApi';
import { useOptionalBrainContext } from '@seanhogg/builderforce-brain-embedded';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { ResumeWorkBridge } from './workspace/ResumeWorkBridge';
import { LastBoardBridge } from './workspace/LastBoardBridge';
import { PlatformAnnouncements } from './announcements/PlatformAnnouncements';
import { ProductUpdatesHost } from './releaseNotes/ProductUpdatesHost';
import { LiveSessionProvider } from '@/lib/live/LiveSessionContext';
import { ActiveCanvasProvider, shellHostsCanvasStage, useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { LiveBar } from './live/LiveBar';
import { NavigationFeaturesProvider } from '@/lib/NavigationFeaturesContext';
import { ExitIntentPrompt } from './marketing/ExitIntentPrompt';

/** Preserve old campaign links while moving prompt-led creation onto Canvas. */
function LegacyPromptCanvasRedirect() {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const prompt = new URLSearchParams(window.location.search).get('prompt')?.trim() ?? '';
    router.replace(`/create/${startGuestCreationSession(prompt, { surface: 'brain' })}`);
  }, [router]);
  return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>{t('openingCanvas')}</div>;
}

/**
 * The guest-room code on an invite link (`?room=`), read from the live URL.
 *
 * Deliberately not `useSearchParams`: that opts the whole tree into a Suspense
 * requirement at build time, and this is a logged-out-only branch of the shell.
 * Reading on mount is enough — the shell is client-rendered and an invite link is
 * always a fresh navigation.
 */
function useGuestInviteCode(): string | null | undefined {
  const pathname = usePathname() || '';
  // `undefined` means the client has not inspected the URL yet. It is distinct
  // from a confirmed `null`: mounting the legacy redirect during this first
  // frame can discard an invite before the effect below reads it.
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      setCode(new URLSearchParams(window.location.search).get('room')?.trim() || null);
    } catch {
      setCode(null);
    }
  }, [pathname]);
  return code;
}

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
  const { authReady, isAuthenticated } = useAuth();
  const isFreelancer = useIsFreelancer();
  const isSales = useIsSalesAssociate();
  const guestRoomCode = useGuestInviteCode();
  // Whether the shell is currently holding a board. Read here — inside the
  // provider — rather than passed down, because it is what decides whether a
  // logged-out visitor keeps the operator shell (see `rendersOperatorShell`),
  // and a shell that answered from the route alone threw a guest's board away.
  const hasBoard = useOptionalActiveCanvas()?.active != null;

  const kind = classifyShell(pathname);

  // Public, marketing and no-chrome routes render on the SERVER with their real
  // content — that is what makes the home page readable by a crawler, a link
  // unfurler and Google's OAuth branding review without an account.
  //
  // An authenticated app route cannot join them: the session lives in
  // localStorage, so `isAuthenticated` is false until it has been read, and
  // rendering now would flash the signed-out teaser at a signed-in user on every
  // hard load. Only those routes wait, and only for the one frame `authReady`
  // takes — guest-legitimate app routes (an anonymous board) are excluded, since
  // for them the signed-out render is the correct one.
  if (!authReady && kind === 'app' && !rendersAppShell(pathname, false)) return null;

  if (kind === 'none') return <>{children}</>;
  if (kind === 'footer') return <FooterOnlyShell>{children}</FooterOnlyShell>;

  // Auth is the chrome switch: logged-out visitors get the marketing top-header
  // nav (MarketingShell); authenticated users keep the left Sidebar. This holds
  // for BOTH marketing/public-browse routes and logged-out hits on app routes.

  // Marketing + public browse.
  if (kind === 'public') {
    // A guest holding a board is the same case as below: opening `/tools/<id>`
    // or `/embedded` to check something must cost a panel, not the board. Only
    // reference surfaces qualify (`rendersOperatorShell` scopes it to routes
    // that open as a panel), so `/blog` and the storefront keep marketing
    // chrome — a long article wants the whole screen either way.
    if (!isAuthenticated) {
      return rendersOperatorShell(pathname, false, hasBoard)
        ? <AppShell>{children}</AppShell>
        : <MarketingShell>{children}</MarketingShell>;
    }
    // §11.4.5's other half. A reference surface is public — that is why it
    // classified as `public` above and why a signed-out visitor and a crawler
    // both get the real page — but signed in it opens OVER the board, so it
    // takes the operator shell and `ShellPanel` renders it as a panel. Without
    // this it would return here as an ordinary public page and the panel would
    // never mount, which is the same "it leaves your session" bug in a new
    // costume. No `OnboardingGate`, for the same reason the tabbed public
    // routes below skip it: the page stays viewable with or without a workspace.
    if (isReferenceSurface(pathname)) return <AppShell>{children}</AppShell>;
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
      const entry = classifyGuestBrainstormEntry(guestRoomCode);
      // `?room=` is a guest INVITE link — the landing surface for a shared free
      // session. It must render the guest room, not bounce through the legacy
      // prompt→canvas redirect, which would drop the code and the invitee with it.
      if (entry === 'resolving') return <MarketingShell>{null}</MarketingShell>;
      if (entry === 'room' && guestRoomCode) {
        return <MarketingShell><GuestBrainPanel variant="page" inviteCode={guestRoomCode} /></MarketingShell>;
      }
      return <MarketingShell><LegacyPromptCanvasRedirect /></MarketingShell>;
    }
    // Anonymous Create sessions are real, editable local-first canvases — so they
    // get the REAL shell, identical to the signed-in one (PRD 21 §0). Marketing
    // chrome here was the whole defect: a guest opening a board saw the top-of-
    // funnel nav where the session list, the stage and the team belong, and
    // therefore saw a different product from the one they were signing up for.
    // Every part of that shell self-gates on auth (disable, never hide), so the
    // difference between the two visitors is what is ENABLED, not what exists.
    if (rendersAppShell(pathname, false)) {
      return <AppShell>{children}</AppShell>;
    }
    // …and a guest who is mid-board keeps that shell while they consult a
    // destination: the teaser is the honest answer, but it belongs in the panel
    // over their board, not in a page that destroys it. `AppShell` puts it in
    // `ShellPanel` on its own, because `panelOpen` is already true here.
    if (rendersOperatorShell(pathname, false, hasBoard)) {
      return <AppShell><RouteMarketing pathname={pathname} /></AppShell>;
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
  // Only `kind === 'app'` reaches here, so this guard covers app routes alone —
  // a reference surface returned above with its page intact. Withholding /soc2
  // from a gig worker who can read it signed out would be a bug, not a
  // permission.
  if (isFreelancer && !isFreelancerAllowedPath(pathname)) {
    return <AppShell>{null}</AppShell>;
  }
  if (isSales && !isSalesAllowedPath(pathname)) {
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

function SalesRouteGuard() {
  const isSales = useIsSalesAssociate();
  const { isAuthenticated } = useAuth();
  const pathname = usePathname() || '';
  const router = useRouter();
  useEffect(() => {
    if (!isAuthenticated || !isSales) return;
    if (classifyShell(pathname) === 'app' && !isSalesAllowedPath(pathname)) router.replace('/sales');
  }, [isAuthenticated, isSales, pathname, router]);
  return null;
}

/**
 * Close anonymous attribution as soon as this browser authenticates — and keep
 * what the visitor made while anonymous.
 *
 * Two things convert here. `convertVisitor` closes the marketing lead. The guest
 * ROOM claim is the one that matters to the person: a shared free session lives in
 * a Durable Object that expires, so signing up is the only moment its conversation
 * can be turned into something they keep. The claimed chat is opened straight
 * away — a conversation silently filed into a history they haven't discovered yet
 * reads exactly like having lost it.
 */
function MarketingConversionTracker() {
  const { isAuthenticated, hasTenant } = useAuth();
  const brain = useOptionalBrainContext();
  const claimed = useRef(false);

  useEffect(() => {
    if (isAuthenticated) convertVisitor();
  }, [isAuthenticated]);

  useEffect(() => {
    // Needs a tenant: the transcript is written into that tenant's Brain chats.
    if (!isAuthenticated || !hasTenant || claimed.current) return;
    claimed.current = true;
    void claimGuestRoomIntoAccount().then((chatId) => {
      if (!chatId || !brain) return;
      brain.setActiveChatId(chatId);
      brain.setOpen(true);
    });
  }, [isAuthenticated, hasTenant, brain]);

  return null;
}

/**
 * The chrome, resolved INSIDE the provider tree.
 *
 * `useShellContent` reads the active canvas, and `ActiveCanvasProvider` is
 * mounted below `AppBrainShell` — deliberately, so the board survives a move
 * between the operator shell and the public one. Computing the content in the
 * parent therefore meant deciding which shell to render from a board the
 * decision could not see. A component is the whole fix: same hook, one level
 * down, where the context exists.
 */
function ShellContent({ children }: { children: React.ReactNode }) {
  return <>{useShellContent(children)}</>;
}

function AppBrainShell({ children, qualityEndpoint }: {
  children: React.ReactNode;
  qualityEndpoint: string;
}) {
  const { hasTenant, isAuthenticated } = useAuth();
  const pathname = usePathname() || '';
  // Whether THIS route's shell renders the persistent stage. Derived rather than
  // reported by the stage on mount: a flag that arrives one commit late makes the
  // route render the board for a frame before handing it over, loading it twice.
  const stageHosted = shellHostsCanvasStage(pathname, isAuthenticated);
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
    <NavigationFeaturesProvider>
    <ProjectScopeProvider>
    {/* The live session and the active canvas are the two things that must
        outlive a navigation, so they are mounted ABOVE the shell switch — a
        provider inside AppShell would be torn down the moment a route moved
        between the app shell and the public one, taking the call with it. */}
    <ActiveCanvasProvider stageHosted={stageHosted}>
    <LiveSessionProvider>
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
          <BrainActionsProvider>
            <BrainContextProvider>
              <ReportErrorProvider endpoint={qualityEndpoint}>
              <ShellContent>{children}</ShellContent>
              {/* BurnRateOS consolidation: one anonymous-only exit-intent capture
                  across every non-embed surface, backed by the canonical
                  Builderforce newsletter store. */}
              <ExitIntentPrompt />
              {/* The room, rendered once at shell level so the call is visible —
                  and controllable — from wherever the person has navigated to.
                  Self-gating: no room, no bar. */}
              <LiveBar />
              {/* Superadmin-authored messages to whoever is on the page. Mounted
                  here rather than in a shell because it must reach BOTH the
                  logged-out marketing pages and the signed-in app; it decides
                  its own visibility and renders nothing when this visitor has
                  no targeted message. */}
              <PlatformAnnouncements />
              {/* The changelog, mounted once for every route — the footer version
                  and the sidebar version both open THIS panel, and it owns the
                  `?whatsnew=1` deep link the release-digest email sends. */}
              <ProductUpdatesHost />
              <MarketingConversionTracker />
              {/* Claims every account-less canvas this browser holds the moment a
                  tenant exists, and offers the way back. Driven by the local-draft
                  INDEX rather than `?next=`, so a redirect lost to an OAuth round
                  trip or the workspace picker is no longer data loss. Self-gating:
                  renders nothing unless it actually rescued something. */}
              <ResumeWorkBridge />
              {/* Puts the board you last worked on back on the stage, so
                  `/settings` resolves to a board plus a panel and sign-in lands
                  on your work rather than a dashboard (PRD 21 §6.7 / §6.8).
                  Free for anyone who has never opened a canvas. */}
              <LastBoardBridge />
              <FreelancerRouteGuard />
              <SalesRouteGuard />
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
              {/* Navigation tools: list_destinations / show_panel over the SAME
                  registry the palette and sidebar read, so asking to open a page
                  and searching for it can never disagree about what exists. */}
              {showBrain && hasTenant && <DestinationBrainBridge />}
              {/* `show_canvas` — the Brain lays a set of ideas out as notes and OPENS
                  them on the Creation Canvas. It used to fill a right-hand drawer
                  running a second canvas implementation; that board folded into this
                  one, so the tool now needs no provider, only the router. */}
              {showBrain && <CanvasPanelBrainBridge />}
              </ReportErrorProvider>
            </BrainContextProvider>
          </BrainActionsProvider>
          </DevexPanelProvider>
          </FinancePanelProvider>
        </DeliveryPanelProvider>
      </AiInsightPanelProvider>
      </PinsProvider>
    </BrainProvider>
    </LiveSessionProvider>
    </ActiveCanvasProvider>
    </ProjectScopeProvider>
    </NavigationFeaturesProvider>
  );
}

export default function ConditionalAppShell({ children, qualityEndpoint }: {
  children: React.ReactNode;
  qualityEndpoint: string;
}) {
  // `/embed` is framed cross-origin (VS Code webview / third-party host) and gets a
  // lean provider tree (no global Brain launcher/bridges) so a webview-hostile
  // global effect can't take the framed page down with it; every other route gets
  // the full app tree. Branch by delegating to distinct child components so neither
  // path ever calls the other's hooks conditionally (rules-of-hooks safe).
  const pathname = usePathname() || '';
  return isFramedEmbed(pathname) ? (
    <EmbedShell>{children}</EmbedShell>
  ) : (
    <AppBrainShell qualityEndpoint={qualityEndpoint}>
      {children}
    </AppBrainShell>
  );
}
