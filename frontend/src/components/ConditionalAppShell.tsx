'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';
import AppFooter from './AppFooter';

const APP_SHELL_PATHS = ['/dashboard', '/ide', '/training', '/tenants'];

const FOOTER_ONLY_PATHS = ['/login', '/register'];

/** True when path is /projects/:id (IDE page) */
function isProjectIdPage(pathname: string): boolean {
  return /^\/projects\/[^/]+$/.test(pathname);
}

function useShowAppShell(): boolean {
  const pathname = usePathname();
  if (!pathname) return false;
  if (isProjectIdPage(pathname)) return true; // IDE (projects): keep shell, no padding (via .ide-full-height)
  if (pathname.startsWith('/ide')) return true; // /ide/[id] — same shell, no padding (via .ide-full-height)
  if (APP_SHELL_PATHS.some((p) => pathname === p)) return true;
  if (pathname.startsWith('/projects')) return true; // /projects list
  if (pathname.startsWith('/tasks')) return true;
  if (pathname.startsWith('/workforce')) return true;
  if (pathname.startsWith('/marketplace')) return true;
  if (pathname.startsWith('/chats')) return true;
  if (pathname.startsWith('/brainstorm')) return true;
  if (pathname.startsWith('/content-manager')) return true;
  if (pathname.startsWith('/skills')) return true;
  if (pathname.startsWith('/personas')) return true;
  if (pathname.startsWith('/pricing')) return true;
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

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const showShell = useShowAppShell();
  const showFooterOnly = useShowFooterOnly();
  if (showShell) return <AppShell>{children}</AppShell>;
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
