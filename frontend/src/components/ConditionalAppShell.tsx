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
import { McpExtensionsBridge } from './brain/McpExtensionsBridge';
import { PlatformActionsBridge } from './brain/PlatformActionsBridge';
import { useAuth } from '@/lib/AuthContext';

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
const PUBLIC_SHELL_PREFIXES = ['/product', '/blog', '/agents', '/pricing', '/compare', '/marketplace', '/prompts', '/models', '/integrations', '/diagnostics', '/tools'];

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

  const kind = classifyShell(pathname);
  if (kind === 'none') return <>{children}</>;
  if (kind === 'footer') return <FooterOnlyShell>{children}</FooterOnlyShell>;

  // Auth is the chrome switch: logged-out visitors get the marketing top-header
  // nav (MarketingShell); authenticated users keep the left Sidebar. This holds
  // for BOTH marketing/public-browse routes and logged-out hits on app routes.

  // Marketing + public browse.
  if (kind === 'public') {
    return isAuthenticated
      ? <PublicShell>{children}</PublicShell>
      : <MarketingShell>{children}</MarketingShell>;
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
  return (
    <OnboardingGate renderShell={(gated) => <AppShell>{gated}</AppShell>}>
      {children}
    </OnboardingGate>
  );
}

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const content = useShellContent(children);
  const { hasTenant } = useAuth();

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
              <FloatingBrain />
              {/* Make the Brain the epicenter for every action: register the platform
                  capability tools + the tenant's server-side MCP extension tools.
                  Both are auth-gated — they call the gateway with the tenant token. */}
              {hasTenant && <PlatformActionsBridge />}
              {hasTenant && <McpExtensionsBridge />}
              {/* Insights slide-out tools — register `show_ai_insight` +
                  `show_delivery_insight` so the Brain can surface insights in the
                  shared drawers. */}
              <AiInsightPanelBrainBridge />
              <DeliveryPanelBrainBridge />
              <FinancePanelBrainBridge />
              <DevexPanelBrainBridge />
              {/* Canvas slide-out tool: `show_canvas` lets the Brain generate a
                  visual board (notes/timers) and the user save it to Knowledge. */}
              <CanvasPanelBrainBridge />
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
