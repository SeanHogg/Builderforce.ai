/**
 * The gateway's REST MCP transport — the tenant's MCP extension tools, advertised to
 * the client-side Brain tool loop and relayed server-to-server. The customer's MCP
 * secret is decrypted + used only server-side (in the shared gateway module) — never
 * sent to the browser.
 *
 * GET  /v1/mcp/tools    — the caller's tool catalog (optionally `?surface=`-narrowed)
 * GET  /v1/mcp/surfaces — the named catalog subsets `?surface=` accepts
 * POST /v1/mcp/call     — relay one MCP tool call
 */
import type { Hono } from 'hono';
import type { Env, HonoEnv } from '../../../env';
import { statusResponse } from '../../middleware/errorResponse';
import { isClientError, statusOf } from '../../../domain/shared/errors';
import { parseOptionalBody } from '../requestBody';
import { McpCallBody } from '../llmRoutes.schemas';
import { requestDb } from '../../../application/shared/dbHandle';
import { callGatewayMcpTool, listGatewayMcpTools, UnknownToolSurfaceError } from '../../../application/llm/mcpGateway';
import { DEFAULT_TOOL_SURFACE, describeToolSurfaces } from '../../../application/llm/toolSurfaces';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountMcpGatewayRoutes(router: Hono<HonoEnv>): void {
  // The Brain's tool loop runs client-side, so it fetches the tenant's enabled
  // MCP tools here and registers each as a BrainAction whose run() posts to
  // /v1/mcp/call below.
  router.get('/v1/mcp/tools', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const db = requestDb(c);
    // THREE sources, one list — built by the shared gateway module so this REST
    // transport and the spec JSON-RPC transport (`POST /mcp`) can never drift.
    // `?surface=` narrows the catalog (see application/llm/toolSurfaces); absent
    // = the whole thing, which is what every existing client already receives.
    try {
      const tools = await listGatewayMcpTools({
        db,
        env: c.env as Env,
        tenantId: access.tenantId,
        keyMaterial: c.env.JWT_SECRET,
        surface: c.req.query('surface') ?? null,
      });
      return c.json({ tools, surface: c.req.query('surface')?.trim() || DEFAULT_TOOL_SURFACE });
    } catch (e) {
      if (e instanceof UnknownToolSurfaceError) {
        return c.json(
          { error: e.message, code: 'unknown_tool_surface', surfaces: describeToolSurfaces() },
          400,
        );
      }
      throw e;
    }
  });

  // Static registry data, so it needs neither the tenant's tools nor a DB hit —
  // only proof that the caller is a real tenant.
  router.get('/v1/mcp/surfaces', async (c) => {
    try {
      await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    return c.json({ surfaces: describeToolSurfaces() });
  });

  router.post('/v1/mcp/call', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const body = await parseOptionalBody(c, McpCallBody);
    if (!body.extensionId || !body.tool) {
      return c.json({ error: 'extensionId and tool are required' }, 400);
    }
    const db = requestDb(c);
    try {
      const result = await callGatewayMcpTool(
        { db, env: c.env as Env, tenantId: access.tenantId, keyMaterial: c.env.JWT_SECRET },
        { extensionId: body.extensionId, tool: body.tool, arguments: body.arguments },
        {
          userId: access.userId,
          role: access.role,
          // Forwarded so route-replay tools run as the caller (JWT) or mint for gateway keys.
          authToken: (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '') || null,
          executionCtx: c.executionCtx,
        },
      );
      return c.json({ result });
    } catch (e) {
      // Recoverable: hand the model a tool-error result, don't 500 the loop — but the
      // STATUS has to say which KIND of failure it was. Every throw used to become a
      // flat 502, so a ticket that simply does not exist came back as
      // `Task '67' not found (HTTP 502)`: a caller could not tell "this id is wrong,
      // move on" from "the relay is down, retry later", and a real outage looked
      // identical to a typo. `statusOf` is the one place an error becomes a status, so
      // a 4xx now surfaces as itself; anything unmapped (500) stays 502, because from
      // the caller's side it is the relay that failed.
      const status = statusOf(e);
      return statusResponse(c, { error: e instanceof Error ? e.message : 'MCP call failed' }, isClientError(status) ? status : 502, { source: 'presentation/routes/llm/mcpGatewayRoutes.ts', operation: 'gatewayMcpCall' }, e);
    }
  });
}
