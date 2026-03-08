'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';

const APP_SHELL_PATHS = ['/dashboard', '/ide', '/training', '/tenants'];

function useShowAppShell(): boolean {
  const pathname = usePathname();
  if (!pathname) return false;
  if (APP_SHELL_PATHS.some((p) => pathname === p)) return true;
  if (pathname.startsWith('/projects')) return true;
  if (pathname.startsWith('/tasks')) return true;
  if (pathname.startsWith('/workforce')) return true;
  if (pathname.startsWith('/chats')) return true;
  if (pathname.startsWith('/brainstorm')) return true;
  if (pathname.startsWith('/content-manager')) return true;
  if (pathname.startsWith('/skills')) return true;
  if (pathname.startsWith('/personas')) return true;
  if (pathname.startsWith('/pricing')) return true;
  if (pathname.startsWith('/security')) return true;
  if (pathname.startsWith('/settings')) return true;
  if (pathname.startsWith('/logs')) return true;
  if (pathname.startsWith('/timeline')) return true;
  if (pathname.startsWith('/debug')) return true;
  return false;
}

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const showShell = useShowAppShell();
  if (showShell) return <AppShell>{children}</AppShell>;
  return <>{children}</>;
}
