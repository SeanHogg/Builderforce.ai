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
 * endpoint, **stateless** by default (no session ids or server→client stream), which is
 * exactly the profile AWS requires of a listed MCP server and the simplest one
 * for remote clients to consume. The tool catalog and dispatch are NOT
 * reimplemented here — both come from `application/llm/mcpGateway`, so this
 * transport and the REST transport always advertise and run the same tools.
 *
 * Auth: `Authorization: Bearer bfk_…` (a tenant API key from the portal). The
 * tenant scope of that key is the tenant scope of every tool call.
 *
 * DISCOVERY IS PUBLIC (spec-permitted): `initialize`, `ping` and `tools/list`
 * answer with NO token, advertising only the static first-party catalog
 * (`listPublicMcpTools` — never tenant connectors, external servers, or
 * feature-gated/operator tools). Registries and choosing agents can see what
 * this server does before sign-up. `tools/call` always requires the key, and a
 * PRESENTED-but-rejected credential is a 401 challenge even on discovery — an
 * invalid key must never silently downgrade to the anonymous preview.
 *
 * The authenticated `?profile=interactive` profile adds catalog resources and
 * prompts and a bounded GET SSE stream for catalog invalidations.
 */

import { reportServerError } from '../middleware/errorResponse';
import { ErrorCode, mcpRejection, safeToolError } from "@seanhogg/builderforce-mcp/protocol";
import { createMcpServer, serveMcpCatalogStream, serveStatelessMcp } from "@seanhogg/builderforce-mcp/server";
import { Hono, type Context } from 'hono';
import { listGatewayMcpTools, listPublicMcpTools, callGatewayMcpTool, resolveGatewayMcpTool, type GatewayMcpContext } from '../../application/llm/mcpGateway';
import { catalogHelp, CATALOG_STREAM_LIFETIME_MS, INTERACTIVE_MCP_PROFILE, watchCatalog } from '../../application/llm/mcp/mcpCatalogProfile';
import { describeToolSurfaces, resolveToolSurface, TOOL_SURFACES } from '../../application/llm/toolSurfaces';
import { requireTenantAccess, type TenantAccess } from './llmRoutes';
import type { Env, HonoEnv } from '../../env';
import { RequestValidationError } from '../../domain/shared/errors';
import { INVALID_JSON_MESSAGE, parseBody, z } from './requestBody';
// Tool dispatch defers best-effort audit writes with it; an absent context awaits inline.
import { optionalExecutionCtx } from './requestScope';

/** One JSON-RPC message, or a batch of them for older clients. */
const JsonRpcBody = z.union([z.looseObject({}), z.array(z.unknown())]);

/**
 * Advertised on `initialize`. `version` describes THIS MCP surface, not the API
 * worker's release — it is the version the MCP Registry listing carries, so the
 * two are pinned together by a test rather than bumped on every API deploy.
 */
export const SERVER_INFO = { name: 'builderforce', title: 'Builderforce', version: '1.1.0' } as const;

/**
 * Methods an ANONYMOUS caller may use. Everything else (notably `tools/call`,
 * and any method we do not know) requires the tenant key — the fail-safe is
 * that an unrecognised method is never treated as public.
 */
const PUBLIC_METHODS: ReadonlySet<string> = new Set(['initialize', 'ping', 'tools/list']);

/** Whether one batch entry is public discovery (a notification always is). */
function isPublicDiscovery(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const { method } = entry as { method?: unknown };
  return typeof method === 'string' && (PUBLIC_METHODS.has(method) || method.startsWith('notifications/'));
}

function unauthorized(c: Context<HonoEnv>) {
  return c.json(
    mcpRejection(ErrorCode.InvalidRequest, 'Unauthorized: send a Builderforce tenant API key as `Authorization: Bearer bfk_…`'),
    401,
    { 'WWW-Authenticate': 'Bearer realm="builderforce"' },
  );
}

function unknownSurface(c: Context<HonoEnv>, surface: string | null) {
  return c.json(
    mcpRejection(ErrorCode.InvalidParams, `Unknown tool surface '${(surface ?? '').trim()}'`, {
      surfaces: describeToolSurfaces(),
    }),
    400,
  );
}

function gatewayContext(env: Env, access: TenantAccess, surface: string | null): GatewayMcpContext {
  return { env, tenantId: access.tenantId, keyMaterial: env.JWT_SECRET, role: access.role, surface, names: 'canonical' };
}

function platformServer(
  c: Context<HonoEnv>,
  access: TenantAccess | null,
  requestedSurface: string | null,
  interactive: boolean,
) {
  const gateway = access === null ? null : gatewayContext(c.env, access, requestedSurface);
  const authToken = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '') || null;
  const executionCtx = optionalExecutionCtx(c);
  return createMcpServer({
    list: () => gateway === null ? listPublicMcpTools(requestedSurface, 'canonical') : listGatewayMcpTools(gateway),
    resolve: resolveGatewayMcpTool,
    call: (entry, args) => {
      if (!gateway || !access) throw new Error('Unauthorized');
      return callGatewayMcpTool(gateway, { extensionId: entry.extensionId, tool: entry.tool, arguments: args }, {
        userId: access.userId, role: access.role, authToken, executionCtx,
      });
    },
  }, {
    info: SERVER_INFO,
    instructions: 'Call tools/list for the live Builderforce catalog. Select a narrower catalog with ?surface=<id> ('
      + TOOL_SURFACES.map((surface) => surface.id).join(', ') + ').'
      + (access === null ? ' You are not signed in. Send Authorization: Bearer bfk_… to see your workspace tools and call them.' : ''),
    // The authenticated gateway applies tenant roles and per-tool consent at dispatch.
    gate: { approveWrite: () => access !== null },
    ...(interactive ? { listChanged: true, ...catalogHelp() } : {}),
  });
}

export function createMcpServerRoutes(watchOptions?: { intervalMs?: number; lifetimeMs?: number }): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', async (c) => {
    // Body first: whether auth is required depends on the METHOD, and discovery
    // (initialize/ping/tools/list) is public. Both refusals keep the protocol's
    // envelope — an MCP client cannot read the API's `{ error, issues }` shape.
    // Not JSON is -32700; JSON that is neither a request object nor a batch (a
    // bare string, a number, null) is -32600.
    let body: z.infer<typeof JsonRpcBody>;
    try {
      body = await parseBody(c, JsonRpcBody);
    } catch (error) {
      if (!(error instanceof RequestValidationError)) throw error;
      const unparseable = error.issues.some((issue) => issue.message === INVALID_JSON_MESSAGE);
      return c.json(
        unparseable
          ? mcpRejection(ErrorCode.ParseError, 'Request body is not valid JSON')
          : mcpRejection(ErrorCode.InvalidRequest, 'Invalid JSON-RPC 2.0 request'),
        400,
      );
    }

    const interactive = c.req.query('profile') === INTERACTIVE_MCP_PROFILE;
    const authHeader = c.req.header('Authorization') ?? '';
    const entries = Array.isArray(body) ? body : [body];
    const discoveryOnly = entries.every(isPublicDiscovery);

    // Anonymous is allowed ONLY for a wholly-discovery request with NO credential
    // presented. A presented-but-rejected key is a 401 challenge even on
    // discovery — silently downgrading a bad key to the public preview would
    // hide the client's misconfiguration and break its auth-retry flow.
    let access: TenantAccess | null = null;
    if (interactive || authHeader !== '' || !discoveryOnly) {
      try {
        access = await requireTenantAccess(c);
      } catch {
        // MCP clients drive their auth flow off a 401 + challenge, so this path
        // must NOT reuse the gateway's generic access-error responder.
        return unauthorized(c);
      }
    }

    // The endpoint URL carries the catalog subset, because a remote MCP client
    // configures ONE url and has no other channel to say "just the delivery
    // tools" — `https://…/mcp?surface=delivery` is that channel.
    const requestedSurface = c.req.query('surface') ?? null;
    if (resolveToolSurface(requestedSurface) === null) return unknownSurface(c, requestedSurface);
    try {
      const server = platformServer(c, access, requestedSurface, interactive);
      return await serveStatelessMcp(server, c.req.raw, body, { legacyFallbackVersion: '2025-06-18' });
    } catch (error) {
      reportServerError(c, error, { source: 'presentation/routes/mcpServerRoutes.ts', operation: 'rpc' });
      return c.json(mcpRejection(ErrorCode.InternalError, safeToolError('mcp', error instanceof Error ? error.message : 'Internal error')), 500);
    }
  });

  router.get('/', async (c) => {
    if (c.req.query('profile') !== INTERACTIVE_MCP_PROFILE) {
      return c.json(mcpRejection(ErrorCode.MethodNotFound, 'This MCP server is stateless; use POST'), 405);
    }
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch {
      return unauthorized(c);
    }
    const requestedSurface = c.req.query('surface') ?? null;
    if (resolveToolSurface(requestedSurface) === null) return unknownSurface(c, requestedSurface);
    const server = platformServer(c, access, requestedSurface, true);
    const load = async () => {
      let current: TenantAccess;
      try {
        current = await requireTenantAccess(c);
      } catch {
        return null;
      }
      if (current.tenantId !== access.tenantId || current.userId !== access.userId
          || current.tenantApiKeyId !== access.tenantApiKeyId || current.agentHostId !== access.agentHostId) return null;
      return listGatewayMcpTools(gatewayContext(c.env, current, requestedSurface));
    };
    return serveMcpCatalogStream(server, c.req.raw, async (signal, changed) => {
      try {
        await watchCatalog(load, changed, signal, watchOptions?.intervalMs);
      } catch (error) {
        if (!signal.aborted) {
          reportServerError(c, error, { source: 'presentation/routes/mcpServerRoutes.ts', operation: 'catalogStream' });
        }
      }
    }, watchOptions?.lifetimeMs ?? CATALOG_STREAM_LIFETIME_MS);
  });
  // The server does not hold sessions, so there is no session to delete.
  router.delete('/', (c) => c.json(mcpRejection(ErrorCode.MethodNotFound, 'This MCP server is stateless; there is no session to end'), 405));

  return router;
}
