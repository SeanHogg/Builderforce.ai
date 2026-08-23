/**
 * Named TOOL SURFACES — the one registry that decides how much of the catalog a
 * caller is advertised.
 *
 * The gateway's catalog is the union of three sources (first-party platform
 * tools, connected connectors, the tenant's own MCP servers) and has grown past
 * 360 entries. Every one of them carries a description and a JSON-Schema, so the
 * catalog alone can dominate a model's prompt budget before the conversation is
 * considered — and most providers degrade sharply past ~128 tool definitions.
 *
 * Our own Brain already trims PER TURN (`brain-embedded/selectTools`), but a
 * third-party MCP client cannot: it lists once, on connect, and advertises
 * whatever it got to its model on every turn thereafter. `tools/list` was the
 * only door and it was unfiltered, so "connect Builderforce to Claude" meant
 * "hand Claude 363 tool definitions".
 *
 * A surface is DATA, not a branch: a new one is another entry below, and both
 * transports (`GET /v1/mcp/tools?surface=…`, `POST /mcp?surface=…`) resolve it
 * through the same two functions. Selection rules, in order of how little they
 * can drift:
 *   • `all`        — no filtering at all (what `full` is).
 *   • `tools`      — an explicit id allowlist (reuses the curated cloud-agent set).
 *   • `domains`    — the `domain` half of a `domain.method` id.
 *   • `readOnly`   — derived from the advertised `mutates` flag; nothing to curate.
 *
 * NOT AN AUTHORIZATION BOUNDARY. A surface shapes what is ADVERTISED; what a
 * caller may actually DO is decided by tenant RBAC and, for unattended agents, by
 * `CLOUD_AGENT_PLATFORM_TOOLS`. A narrowed surface must never be the only thing
 * standing between a caller and a tool it should not reach.
 */

import { BUILTIN_EXTENSION_ID, CLOUD_AGENT_PLATFORM_TOOLS } from './builtinMcpService';
import { CONNECTOR_EXTENSION_ID } from '../connectors/connectorTools';
import type { McpToolEntry } from './mcpExtensionService';

/** The three sources the gateway unions, as a surface refers to them. */
export type ToolSource = 'builtin' | 'connectors' | 'extensions';

/** How a surface picks first-party platform tools out of the catalog. */
export type BuiltinSelection =
  /** Everything the catalog holds. */
  | { kind: 'all' }
  /** Only tools whose `domain.method` id has one of these domains. */
  | { kind: 'domains'; domains: readonly string[] }
  /** An explicit allowlist of `domain.method` ids. */
  | { kind: 'tools'; tools: readonly string[] }
  /** Only tools that explicitly advertise `mutates: false`. */
  | { kind: 'readOnly' };

export interface ToolSurfaceDefinition {
  /** URL-safe id used as `?surface=`. */
  id: string;
  /** One line for the discovery endpoint / portal. */
  description: string;
  builtin: BuiltinSelection;
  /** Sources beyond `builtin` this surface carries. */
  sources: readonly ToolSource[];
}

/**
 * Delivery vocabulary — the domains a "run my projects" client actually needs.
 * Deliberately excludes the platform's own administration (api keys, provider
 * keys, migrations, agent hosts, cron, security) and every vertical (ads,
 * marketing, sales, social, incidents, meetings, …): a client that wants those
 * asks for `full`.
 */
const DELIVERY_DOMAINS = [
  'projects', 'tasks', 'tickets', 'work_items', 'kanban', 'swimlanes', 'swimlane_agents',
  'boards', 'board_data', 'specs', 'roadmap', 'objectives', 'key_results', 'initiatives',
  'portfolios', 'pmo', 'approvals', 'reviews', 'retro', 'poker', 'chats', 'project_files',
  'project_facts', 'project_agents', 'dashboards', 'session',
] as const;

/**
 * The registry. `full` is FIRST and is the default, so a caller that names no
 * surface keeps exactly the behaviour every existing client already has.
 */
export const TOOL_SURFACES: readonly ToolSurfaceDefinition[] = [
  {
    id: 'full',
    description: 'Every tool this tenant has: platform catalog, connected connectors and registered MCP servers.',
    builtin: { kind: 'all' },
    sources: ['builtin', 'connectors', 'extensions'],
  },
  {
    id: 'delivery',
    description: 'Projects, tickets, boards, specs and OKRs — the delivery vocabulary, without platform administration.',
    builtin: { kind: 'domains', domains: DELIVERY_DOMAINS },
    sources: ['builtin', 'connectors', 'extensions'],
  },
  {
    id: 'agent',
    description: 'The curated set an unattended agent may drive: read plus non-destructive writes, no administration.',
    builtin: { kind: 'tools', tools: CLOUD_AGENT_PLATFORM_TOOLS },
    sources: ['builtin', 'connectors', 'extensions'],
  },
  {
    id: 'readonly',
    description: 'Only tools that declare themselves non-mutating. A tool that does not declare it is treated as mutating and excluded.',
    builtin: { kind: 'readOnly' },
    sources: ['builtin', 'connectors', 'extensions'],
  },
  {
    id: 'platform',
    description: 'First-party platform tools only — no connectors, no tenant MCP servers.',
    builtin: { kind: 'all' },
    sources: ['builtin'],
  },
];

/** What a caller gets when it names no surface. */
export const DEFAULT_TOOL_SURFACE = 'full';

/**
 * Resolve a requested surface id, or `null` when it names nothing.
 *
 * An empty/absent id resolves to {@link DEFAULT_TOOL_SURFACE}; an UNKNOWN id
 * resolves to null so the transport can answer 400 rather than silently handing
 * back the full catalog — a typo'd `?surface=deliverey` that quietly advertised
 * everything is the failure this whole module exists to prevent.
 */
export function resolveToolSurface(id: string | null | undefined): ToolSurfaceDefinition | null {
  const wanted = (id ?? '').trim() || DEFAULT_TOOL_SURFACE;
  return TOOL_SURFACES.find((s) => s.id === wanted) ?? null;
}

/** Whether this surface carries a given source at all — lets the gateway SKIP
 *  fetching a source it would only throw away (the extension leg calls every
 *  customer MCP server, so skipping it is latency, not just bytes). */
export function surfaceIncludesSource(surface: ToolSurfaceDefinition, source: ToolSource): boolean {
  return surface.sources.includes(source);
}

/** The `domain` half of a `domain.method` platform tool id. */
function domainOf(toolId: string): string {
  const dot = toolId.indexOf('.');
  return dot > 0 ? toolId.slice(0, dot) : toolId;
}

function builtinMatches(entry: McpToolEntry, selection: BuiltinSelection): boolean {
  switch (selection.kind) {
    case 'all':
      return true;
    case 'domains':
      return selection.domains.includes(domainOf(entry.tool));
    case 'tools':
      return selection.tools.includes(entry.tool);
    case 'readOnly':
      return entry.mutates === false;
  }
}

/**
 * Filter a built catalog down to one surface.
 *
 * Non-builtin sources are kept or dropped whole — a connector action and a
 * tenant's own MCP tool are chosen by the tenant, not by us, so there is nothing
 * for a domain list to say about them. The one exception is `readonly`, which is
 * a claim about behaviour rather than about vocabulary and therefore applies to
 * every source: an entry that does not declare `mutates: false` is treated as
 * mutating (the platform-wide fail-safe) and excluded.
 */
export function applyToolSurface(
  tools: readonly McpToolEntry[],
  surface: ToolSurfaceDefinition,
): McpToolEntry[] {
  return tools.filter((entry) => {
    const source: ToolSource =
      entry.extensionId === BUILTIN_EXTENSION_ID ? 'builtin'
        : entry.extensionId === CONNECTOR_EXTENSION_ID ? 'connectors'
          : 'extensions';
    if (!surface.sources.includes(source)) return false;
    if (source === 'builtin') return builtinMatches(entry, surface.builtin);
    return surface.builtin.kind === 'readOnly' ? entry.mutates === false : true;
  });
}

/** The registry as the discovery endpoint publishes it. */
export function describeToolSurfaces(): Array<{ id: string; description: string; default: boolean }> {
  return TOOL_SURFACES.map((s) => ({ id: s.id, description: s.description, default: s.id === DEFAULT_TOOL_SURFACE }));
}
