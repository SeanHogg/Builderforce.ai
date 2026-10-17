/**
 * The PLATFORM tools — the tenant's gateway MCP catalog (tickets, tasks, dispatch, the
 * builtin servers and any MCP server registered in the portal), offered beside Rovr's
 * browser tools once the person is signed in. Without them a Work-mode run is told to
 * open and staff board work and has nothing to do it with.
 *
 * Nothing about the catalog is Rovr's own: the fetch and the relay are brain-embedded's
 * `fetchMcpToolEntries` + `mcpActionsFrom`, the same client every Brain surface uses.
 * Rovr supplies only the cache (per panel session, 60 s like the editor's), the
 * collision rule (a browser tool's name always wins) and the gate: every platform call
 * that writes (`mutates !== false` — fail safe) pauses on the same approval card as a
 * risky browser action.
 */
import {
  fetchMcpToolEntries,
  mcpActionsFrom,
  toolSpecsFor,
  type BrainAction,
  type BrainTransport,
} from '@seanhogg/builderforce-brain-embedded';
import type { RunCatalog } from '../host/rovrRunHost';
import { ADD_TASK_TOOL, BROWSER_TOOL } from './toolNames';

/** How long one read of the catalog serves runs — the editor's TTL. */
export const PLATFORM_CATALOG_TTL_MS = 60_000;

/** Names Rovr's own tools hold; a platform tool advertising one is dropped, never shadows. */
const ROVR_TOOL_NAMES: ReadonlySet<string> = new Set<string>([...Object.values(BROWSER_TOOL), ADD_TASK_TOOL]);

type CatalogTransport = Pick<BrainTransport, 'baseUrl' | 'getToken'>;

export interface PlatformCatalogDeps {
  baseUrl: string;
  /** The gateway credential, or null signed out (no platform tools). */
  key(): Promise<string | null>;
  /** The catalog read — the shared client by default; a test passes its own. */
  load?(transport: CatalogTransport): Promise<BrainAction[]>;
  now?(): number;
  /** A catalog read failed: the run continues on the browser tools, and the reason is reported. */
  onError?(error: unknown): void;
}

export interface PlatformCatalog {
  /** The platform actions for the next run — empty signed out or while the catalog is unreadable. */
  actions(): Promise<BrainAction[]>;
}

const sharedLoad = async (transport: CatalogTransport): Promise<BrainAction[]> =>
  mcpActionsFrom(await fetchMcpToolEntries(transport), transport);

export function createPlatformCatalog(deps: PlatformCatalogDeps): PlatformCatalog {
  const load = deps.load ?? sharedLoad;
  const now = deps.now ?? Date.now;
  let cached: { key: string; at: number; actions: Promise<BrainAction[]> } | null = null;

  return {
    async actions() {
      const key = await deps.key();
      if (!key) {
        cached = null;
        return [];
      }
      if (cached && cached.key === key && now() - cached.at < PLATFORM_CATALOG_TTL_MS) return cached.actions;
      const transport: CatalogTransport = { baseUrl: deps.baseUrl, getToken: () => key };
      const actions = load(transport)
        .then((list) => list.filter((action) => !ROVR_TOOL_NAMES.has(action.name)))
        .catch((error: unknown) => {
          // Not cached: the next run retries rather than living a minute without tools.
          if (cached?.actions === actions) cached = null;
          deps.onError?.(error);
          return [] as BrainAction[];
        });
      cached = { key, at: now(), actions };
      return actions;
    },
  };
}

/** Does this call of a platform action write? (Advertised flag; mcpActionsFrom fails safe.) */
function writes(action: BrainAction, args: unknown): boolean {
  return typeof action.mutates === 'function' ? action.mutates(args) : action.mutates === true;
}

/**
 * One run's catalog: Rovr's browser tools, then the platform's. A browser tool keeps its
 * own dispatcher and safety gate; a platform tool runs through the gateway relay and
 * pauses for confirmation whenever it writes.
 */
export function withPlatformTools(browser: RunCatalog, platform: readonly BrainAction[]): RunCatalog {
  if (platform.length === 0) return browser;
  const byName = new Map(platform.map((action) => [action.name, action]));
  return {
    specs: [...browser.specs, ...toolSpecsFor(platform)],
    async run(name, args) {
      const action = byName.get(name);
      return action ? action.run(args) : browser.run(name, args);
    },
    needsConfirm(req) {
      const action = byName.get(req.name);
      return action ? writes(action, req.args) : browser.needsConfirm(req);
    },
  };
}

/** True when `name` is a platform tool, not one of Rovr's own (the confirm card's reason). */
export function isPlatformTool(name: string): boolean {
  return !ROVR_TOOL_NAMES.has(name);
}
