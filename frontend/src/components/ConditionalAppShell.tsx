'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';
import AppFooter from './AppFooter';
import PublicShell from './PublicShell';
import OnboardingGate from './OnboardingGate';
import RouteMarketing from './RouteMarketing';
import { BrainActionsProvider, BrainContextProvider, BrainProvider, brainConfig } from '@/lib/brain';
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
const PUBLIC_SHELL_PREFIXES = ['/product', '/blog', '/agents', '/pricing', '/marketplace', '/prompts', '/models'];

// Authenticated app routes — gated behind OnboardingGate inside AppShell.
const APP_SHELL_EXACT = ['/dashboard', '/ide', '/training', '/tenants'];
const APP_SHELL_PREFIXES = [
  '/ide', '/projects', '/tasks', '/workflows', '/agent-worker',
  '/workforce', '/contributors', '/brainstorm', '/content-manager',
  '/skills', '/personas', '/security', '/settings', '/admin',
  '/debug', '/logs', '/timeline',
];

function isProjectIdPage(pathname: string): boolean {
  return /^\/projects\/[^/]+$/.test(pathname);
}

function isNoChrome(pathname: string): boolean {
  return NO_CHROME_PREFIXES.some((p) => pathname.startsWith(p));
}

function isPublicShellPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAppShellPath(pathname: string): boolean {
  if (isProjectIdPage(pathname)) return true;
  if (APP_SHELL_EXACT.includes(pathname)) return true;
  return APP_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  if (isNoChrome(pathname)) return <>{children}</>;
  if (FOOTER_ONLY_PATHS.includes(pathname)) return <FooterOnlyShell>{children}</FooterOnlyShell>;

  // Marketing + public browse → auth-aware PublicShell (renders for logged-out
  // visitors; the app's OnboardingGate would otherwise blank the page pre-auth).
  if (isPublicShellPath(pathname)) return <PublicShell>{children}</PublicShell>;

  // Authenticated app routes.
  if (isAppShellPath(pathname)) {
    // Logged out → render a per-route marketing teaser + login/CTA instead of a
    // blank gate or redirect, so no authed deep link is ever a dead end. The
    // real page never mounts (so its own auth-redirect won't fire).
    if (!isAuthenticated) {
      return (
        <PublicShell>
          <RouteMarketing pathname={pathname} />
        </PublicShell>
      );
    }
    // Signed in → AppShell behind the onboarding/terms gate.
    return (
      <OnboardingGate renderShell={(gated) => <AppShell>{gated}</AppShell>}>
        {children}
      </OnboardingGate>
    );
  }

  // Default: any other route still gets the public chrome so the menu is present.
  return <PublicShell>{children}</PublicShell>;
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
      <BrainActionsProvider>
        <BrainContextProvider>
          {content}
          <FloatingBrain />
          {/* Make the Brain the epicenter for every action: register the platform
              capability tools + the tenant's server-side MCP extension tools.
              Both are auth-gated — they call the gateway with the tenant token. */}
          {hasTenant && <PlatformActionsBridge />}
          {hasTenant && <McpExtensionsBridge />}
        </BrainContextProvider>
      </BrainActionsProvider>
    </BrainProvider>
  );
}
