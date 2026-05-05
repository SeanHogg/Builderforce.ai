'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';
import AppFooter from './AppFooter';
import TopBar from './TopBar';
import OnboardingGate from './OnboardingGate';
import { useAuth } from '@/lib/AuthContext';

const APP_SHELL_PATHS = ['/dashboard', '/ide', '/training', '/tenants'];

const FOOTER_ONLY_PATHS = ['/login', '/register'];

/** True when path is /projects/:id (IDE page) */
function isProjectIdPage(pathname: string): boolean {
  return /^\/projects\/[^/]+$/.test(pathname);
}

/** Routes that are fully public (no auth needed) but still show the TopBar */
function isPublicBrowsePath(pathname: string): boolean {
  return pathname.startsWith('/marketplace');
}

function useShowAppShell(): boolean {
  const pathname = usePathname();
  if (!pathname) return false;
  if (isProjectIdPage(pathname)) return true;
  if (pathname.startsWith('/ide')) return true;
  if (APP_SHELL_PATHS.some((p) => pathname === p)) return true;
  if (pathname.startsWith('/projects')) return true;
  if (pathname.startsWith('/tasks')) return true;
  if (pathname.startsWith('/workforce')) return true;
  if (pathname.startsWith('/marketplace')) return true;
  if (pathname.startsWith('/chats')) return true;
  if (pathname.startsWith('/brainstorm')) return true;
  if (pathname.startsWith('/content-manager')) return true;
  if (pathname.startsWith('/skills')) return true;
  if (pathname.startsWith('/personas')) return true;
  if (pathname.startsWith('/pricing')) return true;
  if (pathname.startsWith('/approvals')) return true;
  if (pathname.startsWith('/security')) return true;
  if (pathname.startsWith('/settings')) return true;
  if (pathname.startsWith('/admin')) return true;
  if (pathname.startsWith('/observability')) return true;
  if (pathname.startsWith('/debug')) return true;
  if (pathname.startsWith('/logs')) return true;
  if (pathname.startsWith('/timeline')) return true;
  return false;
}

function useShowFooterOnly(): boolean {
  const pathname = usePathname();
  if (!pathname) return false;
  if (FOOTER_ONLY_PATHS.some((p) => pathname === p)) return true;
  return false;
}

/**
 * Thin shell for public marketplace browsing: TopBar + page content + footer.
 * No sidebar — unauthenticated users shouldn't see workspace nav.
 */
function PublicBrowseShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBar />
      <main style={{ flex: 1, overflowY: 'auto', padding: '48px 0 0' }}>{children}</main>
      <AppFooter />
    </div>
  );
}

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const showShell = useShowAppShell();
  const showFooterOnly = useShowFooterOnly();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  // Marketplace: full AppShell (with sidebar) when authenticated;
  // public browse shell (TopBar only, no sidebar) when not authenticated.
  if (pathname && isPublicBrowsePath(pathname) && !isAuthenticated) {
    return <PublicBrowseShell>{children}</PublicBrowseShell>;
  }

  if (showShell) {
    return (
      <OnboardingGate renderShell={(gated) => <AppShell>{gated}</AppShell>}>
        {children}
      </OnboardingGate>
    );
  }
  if (showFooterOnly) {
    return (
      <div
        className="layout-footer-only"
        style={{
          height: '100vh',
          maxHeight: '100vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
        <AppFooter />
      </div>
    );
  }
  return <>{children}</>;
}
