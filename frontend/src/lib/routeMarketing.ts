import { PRODUCT_SECTIONS } from './content';

/**
 * Marketing copy shown to logged-out visitors who land on an authenticated
 * route — so a deep link to /dashboard, /ide, /workflows, etc. renders a feature
 * teaser + login/CTA instead of a blank gate, redirect, or 404.
 *
 * Most entries are derived from PRODUCT_SECTIONS (single source of truth for the
 * product surfaces); `extra` covers authed routes that aren't a marketed product
 * surface. Lookup is longest-prefix so /ide/123 and /settings/members resolve.
 */
export interface RouteMarketing {
  icon: string;
  title: string;
  description: string;
}

const fromSurfaces: Record<string, RouteMarketing> = {};
for (const section of PRODUCT_SECTIONS) {
  for (const s of section.surfaces) {
    fromSurfaces[s.href] = { icon: s.icon, title: s.title, description: s.desc };
  }
}

const extra: Record<string, RouteMarketing> = {
  '/projects': { icon: '▦', title: 'Projects', description: 'Organize your work into collaborative AI project workspaces with a full IDE, tasks, and agents.' },
  '/workflows': { icon: '🔀', title: 'Workflow Builder', description: 'Compose agents and tools into repeatable, approval-gated workflows.' },
  '/contributors': { icon: '📈', title: 'Contributors', description: 'See who — human and agent — is contributing across your workspace, and how.' },
  '/settings': { icon: '⚙', title: 'Settings', description: 'Manage your workspace, members, API keys, and preferences.' },
  '/tenants': { icon: '🏢', title: 'Workspaces', description: 'Create and switch between multi-tenant workspaces with per-seat roles.' },
  '/admin': { icon: '⚙', title: 'Platform Admin', description: 'Platform administration, LLM traces, and operator tooling.' },
  '/agent-worker': { icon: '🤖', title: 'Agent Worker', description: 'Run and monitor background agent workers executing your tasks.' },
};

const REGISTRY: Record<string, RouteMarketing> = { ...fromSurfaces, ...extra };

const DEFAULT: RouteMarketing = {
  icon: '🔒',
  title: 'This is part of Builderforce.ai',
  description: 'Sign in to access your AI workforce — build, train, orchestrate, and govern custom AI agents.',
};

export function getRouteMarketing(pathname: string): RouteMarketing {
  if (REGISTRY[pathname]) return REGISTRY[pathname];
  let best: { key: string; val: RouteMarketing } | null = null;
  for (const [key, val] of Object.entries(REGISTRY)) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, val };
    }
  }
  return best?.val ?? DEFAULT;
}
