/**
 * The gateway's MCP tool surface — ONE catalog, ONE dispatcher.
 *
 * Builderforce advertises tools from three sources and every consumer needs the
 * same union of them:
 *   1. first-party platform tools, in-process   ({@link listBuiltinTools})
 *   2. the tenant's CONNECTED connectors        ({@link listConnectorTools})
 *   3. the tenant's external MCP servers        ({@link listToolsForTenant})
 *
 * Two transports sit on top and MUST NOT drift apart:
 *   - `GET /v1/mcp/tools` + `POST /v1/mcp/call` — Builderforce's own REST shape,
 *     used by the browser Brain's client-side tool loop and the VS Code client.
 *   - `POST /mcp` — the JSON-RPC 2.0 / Streamable-HTTP transport every *standard*
 *     MCP client speaks (Claude, Cursor, Bedrock AgentCore, Gemini Enterprise).
 *
 * Both call the functions here, so adding a tool source or changing dispatch is a
 * one-place edit. See `presentation/routes/mcpServerRoutes.ts` for the spec transport.
 *
 * Caching: deliberately none at this layer. Each source already owns the right
 * cache — `connectedConnectorKeys` is read-through cached (300s KV / 60s L1) and
 * `listToolsForTenant` is read-through cached (60s) with explicit invalidation on
 * extension mutations. Wrapping the union again would only add a second, staler
 * copy with no invalidation hook of its own.
 */

import { resolveAdvertisedToolName, toolNameSet } from '@builderforce/agent-tools';
import { resolveName } from '@seanhogg/builderforce-mcp';
import { callConnectorTool, CONNECTOR_EXTENSION_ID, listConnectorTools } from '../connectors/connectorTools';
import { BUILTIN_EXTENSION_ID, callBuiltinTool, listBuiltinTools } from './builtinMcpService';
import {
  BUILTIN_TOOL_FEATURE_GATES,
  BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS,
  entitledBuiltinTools,
} from './builtinToolEntitlements';
import { mayRunBuiltinTool } from './builtinToolAuthority';
import { withSkillCatalog } from './skillLibraryToolCatalog';
import { callMcpTool, listToolsForTenant, type McpToolEntry } from './mcpExtensionService';
import {
  applyToolSurface,
  resolveToolSurface,
  surfaceIncludesSource,
  type ToolSurfaceDefinition,
} from './toolSurfaces';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import type { TenantRole } from '../../domain/shared/types';
import type { Env } from '../../env';

/** Everything the union needs to be built for one tenant. */
export interface GatewayMcpContext {
  env: Env;
  tenantId: number;
  /** JWT signing secret — the key material external MCP secrets are sealed with. */
  keyMaterial: string;
  /**
   * An already-built connection. Optional so a transport that has no business
   * touching the infrastructure layer (see `check-layering`) can just hand over
   * `env`; callers already holding a connection pass it to avoid a second one.
   */
  db?: Db;
  fetchImpl?: typeof fetch;
  /**
   * The caller's tenant role. When set, the ADVERTISED built-in catalog is filtered
   * to the tools that role may actually run — a contributor/viewer is never offered a
   * mutating tool that the dispatcher would only refuse. This mirrors the dispatch-time
   * gate ({@link mayRunBuiltinTool}) so a model cannot be lured into a 403 retry loop,
   * and the settle-phase `tickets.from_delta` auto-capture never fires for a role that
   * cannot mint a ticket. Absent = a machine/agent caller, decided by its run.
   */
  role?: TenantRole | null;
  /**
   * Which named surface to advertise ({@link ./toolSurfaces}). Absent = `full`,
   * so every existing caller keeps the whole catalog. An UNKNOWN id is an error
   * rather than a silent `full`, which is why this is resolved here and not
   * defaulted at each transport.
   */
  surface?: string | null;
}

/** Thrown when a caller names a surface that does not exist. */
export class UnknownToolSurfaceError extends Error {
  constructor(public readonly requested: string) {
    super(`Unknown tool surface '${requested}'`);
    this.name = 'UnknownToolSurfaceError';
  }
}

function surfaceFor(surfaceId: string | null | undefined): ToolSurfaceDefinition {
  const surface = resolveToolSurface(surfaceId);
  if (!surface) throw new UnknownToolSurfaceError((surfaceId ?? '').trim());
  return surface;
}

const dbFor = (ctx: GatewayMcpContext): Db => ctx.db ?? buildDatabase(ctx.env);

/**
 * Drop the built-in tools `role` may not run from the advertised catalog.
 *
 * The dispatch-time gate stays the enforcement; this is the advertisement half of the
 * same rule ({@link mayRunBuiltinTool}), so a sub-developer caller's model is never
 * SHOWN a mutating tool it could only fail on. A role-less caller (an API key, a cloud
 * agent) keeps the whole catalog — its authority is the run that launched it, exactly
 * as the gate leaves it to the replayed route.
 */
export function roleFilterBuiltinTools<T extends { tool: string; mutates?: boolean }>(
  role: TenantRole | null | undefined,
  tools: readonly T[],
): T[] {
  if (role == null) return [...tools];
  return tools.filter((t) => mayRunBuiltinTool(t.tool, t.mutates === true, role));
}

/**
 * The tenant's full advertised tool list.
 *
 * The two network-bound sources are fetched concurrently: the MCP leg calls every
 * customer server, and serialising a cached DB read behind it is free latency.
 */
export async function listGatewayMcpTools(ctx: GatewayMcpContext): Promise<McpToolEntry[]> {
  const surface = surfaceFor(ctx.surface);
  const db = dbFor(ctx);
  // A source the surface excludes is not fetched at all. The extension leg calls
  // every customer MCP server, so skipping it is latency saved, not just bytes.
  const [connectorTools, extensionTools] = await Promise.all([
    surfaceIncludesSource(surface, 'connectors') ? listConnectorTools(db, ctx.tenantId, ctx.env) : [],
    surfaceIncludesSource(surface, 'extensions')
      ? listToolsForTenant(db, ctx.tenantId, ctx.keyMaterial, ctx.fetchImpl ?? fetch, ctx.env)
      : [],
  ]);
  // Feature-gated rows (the Insights tools) are shown only to a workspace holding the feature.
  // `skills.read` then carries THIS workspace's skill catalog in its description (or is
  // dropped when the library is empty) — level one of the Agent Skills disclosure, so
  // every consumer of this list learns which skills exist without a change of its own.
  const builtinTools = surfaceIncludesSource(surface, 'builtin')
    ? await withSkillCatalog(
        ctx.env,
        db,
        ctx.tenantId,
        roleFilterBuiltinTools(ctx.role ?? null, await entitledBuiltinTools(ctx.env, ctx.tenantId, null, listBuiltinTools())),
      )
    : [];
  return applyToolSurface([...builtinTools, ...connectorTools, ...extensionTools], surface);
}

/** Built-in tools that must NEVER appear in the anonymous catalog: every
 *  feature-gated row and every platform-operator row. The anonymous preview has
 *  no tenant to check entitlements against, so the fail-safe is to hide them
 *  all — a signed-in tenant still sees the ones it holds via the gateway. */
const PRIVATE_BUILTIN_TOOL_IDS: ReadonlySet<string> = new Set([
  ...BUILTIN_TOOL_FEATURE_GATES.flatMap((gate) => gate.tools),
  ...BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS,
]);

/**
 * The ANONYMOUS discovery catalog — what `tools/list` advertises with no token.
 *
 * Static first-party metadata only ({@link listBuiltinTools} is a no-DB map over
 * the catalog): no tenant connectors, no external MCP servers, no skill-catalog
 * enrichment, and no feature-gated or operator tools. Registries and choosing
 * agents can see what the server does before sign-up; nothing tenant-specific
 * is ever disclosed. `?surface=` still applies, so a preview can be narrowed
 * the same way the signed-in catalog can.
 */
export function listPublicMcpTools(surface?: string | null): McpToolEntry[] {
  const resolved = surfaceFor(surface);
  if (!surfaceIncludesSource(resolved, 'builtin')) return [];
  return applyToolSurface(listBuiltinTools().filter((t) => !PRIVATE_BUILTIN_TOOL_IDS.has(t.tool)), resolved);
}

/**
 * Resolve a flat, model-facing tool name back to its `(extensionId, tool)` pair.
 *
 * The REST transport is handed both halves by the caller; the JSON-RPC transport
 * only ever sees the flat `name`, because MCP's `tools/call` has a single string
 * identifier. Both therefore route through the SAME `McpToolEntry.name` that was
 * advertised, so a rename can never desync the advertise and call sides.
 */
export function resolveGatewayMcpTool(tools: McpToolEntry[], name: string): McpToolEntry | null {
  // A catalog id (`tasks.archive_many`) or the unprefixed form reaches the advertised tool too
  // (`resolveAdvertisedToolName`, the one resolver every surface shares).
  const resolved = resolveAdvertisedToolName(name, toolNameSet(tools, (t) => t.name));
  if (resolved !== null) return tools.find((t) => t.name === resolved) ?? null;
  const address = resolveName(name);
  return address?.source === 'platform'
    ? tools.find((t) => t.extensionId === BUILTIN_EXTENSION_ID && t.tool === address.tool) ?? null
    : null;
}

/** Identity of the caller a tool runs as. Absent for pure machine (API-key) callers. */
export interface GatewayMcpCaller {
  userId?: string | null;
  role?: TenantRole;
  /** Raw bearer forwarded so route-replay tools run as the caller. */
  authToken?: string | null;
  executionCtx?: ExecutionContext;
}

/**
 * Invoke one tool, whichever source owns it.
 *
 * First-party platform tools run in-process; connector actions go through the
 * shared connector runtime (SSRF-guarded, audited); everything else relays to the
 * tenant's external MCP server with its server-side-decrypted secret.
 */
export async function callGatewayMcpTool(
  ctx: GatewayMcpContext,
  call: { extensionId: string; tool: string; arguments?: unknown },
  caller: GatewayMcpCaller = {},
): Promise<unknown> {
  const db = dbFor(ctx);

  if (call.extensionId === CONNECTOR_EXTENSION_ID) {
    return callConnectorTool({
      db,
      env: ctx.env,
      tenantId: ctx.tenantId,
      tool: call.tool,
      arguments: call.arguments,
    });
  }

  if (call.extensionId === BUILTIN_EXTENSION_ID) {
    return callBuiltinTool(db, {
      tenantId: ctx.tenantId,
      tool: call.tool,
      arguments: call.arguments,
      env: ctx.env,
      userId: caller.userId,
      role: caller.role,
      authToken: caller.authToken,
      executionCtx: caller.executionCtx,
    });
  }

  return callMcpTool(db, {
    tenantId: ctx.tenantId,
    extensionId: call.extensionId,
    tool: call.tool,
    arguments: call.arguments,
    keyMaterial: ctx.keyMaterial,
    // Needed to open a sealed OAuth grant, if this server uses one.
    env: ctx.env,
  });
}

export type { McpToolEntry };
