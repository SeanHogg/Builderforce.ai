/**
 * `POST /mcp` — Builderforce as a **standard remote MCP server**.
 *
 * Everything else in the platform speaks Builderforce's own REST tool shape
 * (`GET /v1/mcp/tools` + `POST /v1/mcp/call`). That shape is fine for our own
 * clients but no third-party MCP client can consume it, which kept us out of
 * every MCP-native distribution channel: Anthropic's Connectors Directory, AWS
 * Marketplace's AI Agents & Tools category, Gemini Enterprise's MCP registry,
 * Cursor/Cline/Goose remote-server config, and the MCP registries.
 *
 * This route is that missing transport: JSON-RPC 2.0 over Streamable HTTP, one
 * endpoint, **stateless** (no session ids, no server→client stream), which is
 * exactly the profile AWS requires of a listed MCP server and the simplest one
 * for remote clients to consume. The tool catalog and dispatch are NOT
 * reimplemented here — both come from `application/llm/mcpGateway`, so this
 * transport and the REST transport always advertise and run the same tools.
 *
 * Auth: `Authorization: Bearer bfk_…` (a tenant API key from the portal). The
 * tenant scope of that key is the tenant scope of every tool call.
 *
 * Spec: https://modelcontextprotocol.io/specification — methods implemented are
 * `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
 */

import { Hono, type Context } from 'hono';
import { listGatewayMcpTools, callGatewayMcpTool, resolveGatewayMcpTool } from '../../application/llm/mcpGateway';
import { describeToolSurfaces, resolveToolSurface, TOOL_SURFACES } from '../../application/llm/toolSurfaces';
import { requireTenantAccess, type TenantAccess } from './llmRoutes';
import type { Env, HonoEnv } from '../../env';

/** Protocol revisions this server can speak, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Advertised on `initialize`. `version` describes THIS MCP surface, not the API
 * worker's release — it is the version the MCP Registry listing carries, so the
 * two are pinned together by a test rather than bumped on every API deploy.
 */
export const SERVER_INFO = { name: 'builderforce', title: 'Builderforce', version: '1.0.0' } as const;

/** JSON-RPC 2.0 reserved error codes (https://www.jsonrpc.org/specification#error_object). */
const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

/** A notification has no `id` and MUST NOT be answered. */
const isNotification = (req: JsonRpcRequest): boolean => req.id === undefined;

/**
 * MCP `tools/call` results are content blocks, not raw JSON. Tool handlers here
 * return arbitrary values (strings, objects, void), so normalise once: strings
 * pass through, everything else is pretty-printed JSON in a text block. Clients
 * that want structure read `structuredContent`, which the spec added for exactly
 * this and which every current client falls back from gracefully.
 */
function toolResultContent(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  if (value === undefined || value === null) {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text }],
    ...(typeof value === 'object' ? { structuredContent: value as Record<string, unknown> } : {}),
  };
}

/** Tool-level failures are results with `isError`, NOT JSON-RPC errors — the model must see them. */
function toolErrorContent(message: string): Record<string, unknown> {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Negotiate the protocol revision. Honour the client's ask when we speak it,
 * otherwise answer with our latest and let the client decide to disconnect —
 * both are spec-permitted, and echoing an unknown version is not.
 */
function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

async function handleRpc(
  req: JsonRpcRequest,
  ctx: {
    env: Env;
    access: TenantAccess;
    authToken: string | null;
    executionCtx?: ExecutionContext;
    /** `?surface=` off the endpoint URL — see application/llm/toolSurfaces. */
    surface: string | null;
  },
): Promise<unknown | null> {
  const id: JsonRpcId = (req.id ?? null) as JsonRpcId;

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return isNotification(req) ? null : rpcError(id, JSON_RPC.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request');
  }

  const method = req.method;
  const params = (req.params ?? {}) as Record<string, unknown>;

  // Notifications: acknowledged by accepting them, never answered.
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return null;
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        'Builderforce exposes this tenant\'s platform tools (projects, tickets, boards, OKRs, executions) '
        + 'plus every connector and external MCP server the tenant has connected. Call tools/list for the '
        + 'live catalog — it varies per tenant. The full catalog is large; append `?surface=<id>` to this '
        + `endpoint URL to advertise a narrower subset instead (${TOOL_SURFACES.map((s) => s.id).join(', ')}).`,
    });
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  // No `db` here on purpose: a route must not reach into the infrastructure
  // layer (enforced by `scripts/check-layering.mjs`). The gateway module opens
  // the connection it needs.
  const gateway = {
    env: ctx.env,
    tenantId: ctx.access.tenantId,
    keyMaterial: ctx.env.JWT_SECRET,
    surface: ctx.surface,
  };

  if (method === 'tools/list') {
    const tools = await listGatewayMcpTools(gateway);
    return rpcResult(id, {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters,
        // `mutates === undefined` means "unknown" (external servers don't declare
        // it), and the platform contract is that unknown is treated as mutating —
        // so only an explicit `false` may advertise a read-only hint.
        annotations: { readOnlyHint: t.mutates === false },
      })),
    });
  }

  if (method === 'tools/call') {
    const name = params.name;
    if (typeof name !== 'string' || name.length === 0) {
      return rpcError(id, JSON_RPC.INVALID_PARAMS, 'tools/call requires a string `name`');
    }
    const tools = await listGatewayMcpTools(gateway);
    const entry = resolveGatewayMcpTool(tools, name);
    if (!entry) {
      return rpcError(id, JSON_RPC.INVALID_PARAMS, `Unknown tool '${name}'`);
    }
    try {
      const result = await callGatewayMcpTool(
        gateway,
        { extensionId: entry.extensionId, tool: entry.tool, arguments: params.arguments ?? {} },
        {
          userId: ctx.access.userId,
          role: ctx.access.role,
          authToken: ctx.authToken,
          executionCtx: ctx.executionCtx,
        },
      );
      return rpcResult(id, toolResultContent(result));
    } catch (e) {
      // Recoverable: hand the model a tool error, don't fail the RPC envelope.
      return rpcResult(id, toolErrorContent(e instanceof Error ? e.message : 'Tool call failed'));
    }
  }

  return isNotification(req) ? null : rpcError(id, JSON_RPC.METHOD_NOT_FOUND, `Unknown method '${method}'`);
}

/**
 * Hono THROWS on `c.executionCtx` when the runtime supplied none. Tool dispatch
 * only uses it to defer best-effort audit writes, so an absent context must
 * degrade to "await inline", never to a 500.
 */
function optionalExecutionCtx(c: Context<HonoEnv>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export function createMcpServerRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch {
      // MCP clients drive their auth flow off a 401 + challenge, so this path
      // must NOT reuse the gateway's generic access-error responder.
      return c.json(
        rpcError(null, JSON_RPC.INVALID_REQUEST, 'Unauthorized: send a Builderforce tenant API key as `Authorization: Bearer bfk_…`'),
        401,
        { 'WWW-Authenticate': 'Bearer realm="builderforce"' },
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, JSON_RPC.PARSE_ERROR, 'Request body is not valid JSON'), 400);
    }

    const authToken = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '') || null;
    // The endpoint URL carries the catalog subset, because a remote MCP client
    // configures ONE url and has no other channel to say "just the delivery
    // tools" — `https://…/mcp?surface=delivery` is that channel.
    const requestedSurface = c.req.query('surface') ?? null;
    if (resolveToolSurface(requestedSurface) === null) {
      return c.json(
        rpcError(null, JSON_RPC.INVALID_PARAMS, `Unknown tool surface '${(requestedSurface ?? '').trim()}'`, {
          surfaces: describeToolSurfaces(),
        }),
        400,
      );
    }
    const ctx = {
      env: c.env as Env,
      access,
      authToken,
      executionCtx: optionalExecutionCtx(c),
      surface: requestedSurface,
    };

    try {
      // Batching was removed in protocol 2025-06-18 but older clients still send
      // arrays, so accept both shapes rather than rejecting a legal older client.
      if (Array.isArray(body)) {
        const responses = (await Promise.all(body.map((entry) => handleRpc(entry as JsonRpcRequest, ctx))))
          .filter((r) => r !== null);
        // An all-notification batch gets 202 with no body, per the transport spec.
        return responses.length === 0 ? c.body(null, 202) : c.json(responses);
      }

      const response = await handleRpc(body as JsonRpcRequest, ctx);
      return response === null ? c.body(null, 202) : c.json(response);
    } catch (e) {
      return c.json(
        rpcError(null, JSON_RPC.INTERNAL_ERROR, e instanceof Error ? e.message : 'Internal error'),
        500,
      );
    }
  });

  // Stateless server: we never open a server→client SSE stream and hold no
  // sessions, so the spec's optional GET and DELETE are explicitly unsupported.
  router.get('/', (c) => c.json(rpcError(null, JSON_RPC.METHOD_NOT_FOUND, 'This MCP server is stateless; use POST'), 405));
  router.delete('/', (c) => c.json(rpcError(null, JSON_RPC.METHOD_NOT_FOUND, 'This MCP server is stateless; there is no session to end'), 405));

  return router;
}
