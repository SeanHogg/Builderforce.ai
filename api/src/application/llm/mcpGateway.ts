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

import { callConnectorTool, CONNECTOR_EXTENSION_ID, listConnectorTools } from '../connectors/connectorTools';
import { BUILTIN_EXTENSION_ID, callBuiltinTool, listBuiltinTools } from './builtinMcpService';
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

function surfaceFor(ctx: GatewayMcpContext): ToolSurfaceDefinition {
  const surface = resolveToolSurface(ctx.surface);
  if (!surface) throw new UnknownToolSurfaceError((ctx.surface ?? '').trim());
  return surface;
}

const dbFor = (ctx: GatewayMcpContext): Db => ctx.db ?? buildDatabase(ctx.env);

/**
 * The tenant's full advertised tool list.
 *
 * The two network-bound sources are fetched concurrently: the MCP leg calls every
 * customer server, and serialising a cached DB read behind it is free latency.
 */
export async function listGatewayMcpTools(ctx: GatewayMcpContext): Promise<McpToolEntry[]> {
  const surface = surfaceFor(ctx);
  const db = dbFor(ctx);
  // A source the surface excludes is not fetched at all. The extension leg calls
  // every customer MCP server, so skipping it is latency saved, not just bytes.
  const [connectorTools, extensionTools] = await Promise.all([
    surfaceIncludesSource(surface, 'connectors') ? listConnectorTools(db, ctx.tenantId, ctx.env) : [],
    surfaceIncludesSource(surface, 'extensions')
      ? listToolsForTenant(db, ctx.tenantId, ctx.keyMaterial, ctx.fetchImpl ?? fetch, ctx.env)
      : [],
  ]);
  const builtinTools = surfaceIncludesSource(surface, 'builtin') ? listBuiltinTools() : [];
  return applyToolSurface([...builtinTools, ...connectorTools, ...extensionTools], surface);
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
  return tools.find((t) => t.name === name) ?? null;
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
