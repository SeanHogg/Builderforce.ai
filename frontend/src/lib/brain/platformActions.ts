'use client';

/**
 * Client-only Brain actions — browser navigation + local UI panels.
 *
 * The Brain's *data* capabilities (projects/tasks/OKRs/workflows/… — the
 * `builtin_*` tools) are now served from the ONE server MCP catalog
 * (`api/.../builtinMcpService.ts CATALOG`, fetched via `/llm/v1/mcp/tools` and
 * registered by {@link McpExtensionsBridge}) — the SAME source the VS Code chat
 * uses, so both brains share one tool set and no capability is declared twice.
 *
 * What remains here is only what the server CANNOT do: move the user's browser.
 * `navigate_to` / `open_project` open a page or the IDE; `open_migration_panel`
 * raises a local UI panel via a window event. These have no server equivalent, so
 * they stay as native client actions. (History: this file used to also mirror
 * ~210 data capabilities that duplicated the catalog; every one was covered by the
 * server catalog, so they were retired — see DONE.md 2026-07-05.)
 */

import type { BrainAction } from '@/lib/brain';

type Json = Record<string, unknown>;

export interface PlatformActionContext {
  /** Router push (injected; this manifest never imports next/navigation). */
  navigate: (path: string) => void;
}

// --- tiny JSON-Schema helpers ----------------------------------------------
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

/** Read a field off the loosely-typed args bag. */
function f<T = unknown>(args: Json, key: string): T {
  return args[key] as T;
}

// ---------------------------------------------------------------------------
// Route table — the pages the Brain can navigate the user to.
// ---------------------------------------------------------------------------

const STATIC_ROUTES: Record<string, string> = {
  dashboard: '/dashboard',
  projects: '/projects',
  ide: '/ide',
  ide_dashboard: '/ide/dashboard',
  brainstorm: '/brainstorm',
  tasks: '/projects?tab=tasks',
  workflows: '/workflows',
  workflow_builder: '/workflows/builder',
  workforce: '/workforce',
  agents: '/agents',
  agent_skills: '/agents/skills',
  agent_integrations: '/agents/integrations',
  agent_workflow_builder: '/agents/workflow-builder',
  marketplace: '/marketplace',
  skills: '/skills',
  personas: '/personas',
  prompts: '/prompts',
  models: '/marketplace?category=models',
  approvals: '/workforce?tab=approvals',
  security: '/security',
  observability: '/workforce?tab=logs',
  timeline: '/workforce?tab=logs',
  logs: '/workforce?tab=logs',
  chats: '/workforce?tab=chats',
  contributors: '/workforce?tab=performance',
  content_manager: '/content-manager',
  agent_worker: '/agent-worker',
  training: '/training',
  tenants: '/tenants',
  settings: '/settings',
  settings_members: '/workforce',
  settings_api_keys: '/settings/integrations',
  compare: '/compare',
  pricing: '/pricing',
  product: '/product',
  admin: '/admin',
};

const DYNAMIC_ROUTES: Record<string, (id: string | number) => string> = {
  project: (id) => `/projects/${id}`,
  // The Tasks board scoped to one project — where a freshly-created task is
  // visible. NOT `/projects/{id}` (that redirects into the IDE).
  project_tasks: (id) => `/projects?tab=tasks&project=${id}`,
  ide_project: (id) => `/ide/${id}`,
  content_item: (id) => `/content-manager/${id}`,
  persona: (id) => `/personas/${id}`,
  skill: (id) => `/skills/${id}`,
};

const ALL_PAGE_KEYS = [...Object.keys(STATIC_ROUTES), ...Object.keys(DYNAMIC_ROUTES)];

/** Resolve a page key (+optional id/query) to a path, or an error object. */
function resolveRoute(page: string, id?: string | number, query?: string): string | { error: string } {
  let path: string | undefined;
  if (STATIC_ROUTES[page]) path = STATIC_ROUTES[page];
  else if (DYNAMIC_ROUTES[page]) {
    if (id == null || id === '') return { error: `Page "${page}" needs an id (e.g. the numeric project id).` };
    path = DYNAMIC_ROUTES[page](id);
  }
  if (!path) return { error: `Unknown page "${page}". Use a known page key (${ALL_PAGE_KEYS.slice(0, 6).join(', ')}, …).` };
  return query ? `${path}?${String(query).replace(/^\?/, '')}` : path;
}

/**
 * Build the client-only Brain actions. All data actions come from the server MCP
 * catalog (registered by McpExtensionsBridge); these three move the browser.
 */
export function buildPlatformActions(ctx: PlatformActionContext): BrainAction[] {
  // Navigation — open any page in the app.
  const navigate_to: BrainAction = {
    name: 'navigate_to',
    description: 'Navigate the browser to a page in the app. For pages about one project (page="project" or "ide_project") pass the numeric project id as `id`. To show a project\'s tasks (e.g. after creating one) use page="project_tasks" with the project id.',
    parameters: obj(
      {
        page: { type: 'string', enum: ALL_PAGE_KEYS, description: 'Page key to open.' },
        id: { type: ['string', 'number'], description: 'Id for dynamic pages (e.g. project id).' },
        query: { ...S, description: 'Optional querystring without the leading "?".' },
      },
      ['page'],
    ),
    mutates: false,
    run: (args) => {
      const a = args as Json;
      const resolved = resolveRoute(f(a, 'page'), f(a, 'id'), f(a, 'query'));
      if (typeof resolved !== 'string') return resolved; // { error }
      ctx.navigate(resolved);
      return { navigated: resolved };
    },
  };

  // Convenience: open a project straight in the IDE ("launch it").
  const open_project: BrainAction = {
    name: 'open_project',
    description: 'Open a project in the IDE (use this to "launch" a project after creating it).',
    parameters: obj({ id: { ...N, description: 'Project id' }, chatId: { ...N, description: 'Optional Brain chat id to carry into the IDE.' } }, ['id']),
    mutates: false,
    run: (args) => {
      const a = args as Json;
      const id = f(a, 'id');
      if (id == null) return { error: 'A project id is required.' };
      const chatId = f<number | undefined>(a, 'chatId');
      ctx.navigate(`/ide/${id}${chatId != null ? `?chat=${chatId}` : ''}`);
      return { opened: `/ide/${id}` };
    },
  };

  // Open the migration / reconciliation work panel on the LEFT (the Brain sits on
  // the right). The Brain calls this after testing a connection so the human can
  // map/combine projects, map item types + users, review and import. Pass a runId
  // to resume an in-progress run, or just a provider to start fresh.
  const open_migration_panel: BrainAction = {
    name: 'open_migration_panel',
    description: 'Open the migration / reconciliation panel on the left so the user can map projects (combine), item types and users, review staged items, and import. Use after connecting + testing a provider credential. Pass runId to resume a run, or provider to start a new one.',
    parameters: obj({
      runId: { ...S, description: 'Existing migration run id to resume/review.' },
      provider: { ...S, description: 'Provider id to start a new migration for (e.g. "bitbucket", "jira", "github").' },
    }),
    mutates: false,
    run: (args) => {
      const a = args as Json;
      const runId = f<string | undefined>(a, 'runId');
      const provider = f<string | undefined>(a, 'provider');
      if (typeof window === 'undefined') return { error: 'Migration panel is only available in the browser.' };
      window.dispatchEvent(new CustomEvent('builderforce:open-migration-panel', { detail: { runId: runId ?? null, provider: provider ?? null } }));
      return { opened: 'migration-panel', runId: runId ?? null, provider: provider ?? null };
    },
  };

  return [navigate_to, open_project, open_migration_panel];
}
