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
import { createMcpCatalogCache, MCP_CATALOG_TTL_MS } from '@seanhogg/builderforce-mcp';
import type { RunCatalog } from '../host/rovrRunHost';
import { ADD_TASK_TOOL, BROWSER_TOOL } from './toolNames';

/** How long one read of the catalog serves runs — the editor's TTL. */
export const PLATFORM_CATALOG_TTL_MS = MCP_CATALOG_TTL_MS;

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
  const catalog = createMcpCatalogCache<BrainAction[]>(deps.now);

  return {
    async actions() {
      const key = await deps.key();
      if (!key) {
        catalog.clear();
        return [];
      }
      const transport: CatalogTransport = { baseUrl: deps.baseUrl, getToken: () => key };
      return catalog.get(key, () => load(transport)
        .catch((error: unknown) => {
          deps.onError?.(error);
          throw error;
        })
        .then((list) => list.filter((action) => !ROVR_TOOL_NAMES.has(action.name))))
        .catch(() => []);
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
