/**
 * The built-in tool CONTEXT primitives — the caller identity a first-party MCP tool
 * runs as, how a tool replays an existing HTTP route under that identity, and the shape
 * of one catalog row.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────
 * `builtinMcpService` owns the CATALOG. A domain large enough to declare its own rows in
 * its own module (the career tools do) needs these three things and nothing else from
 * it — and importing them from the catalog module put a runtime cycle between the two.
 * The cycle happened to be safe, which is the worst kind: it survives until someone
 * moves a `const` above a function declaration and then fails at module-evaluation time,
 * in production, with a message about an uninitialised binding.
 *
 * So the primitives live here, both modules depend on this one, and neither depends on
 * the other. `builtinMcpService` re-exports them, so every existing importer is
 * unaffected.
 */

import { signJwt } from '../../infrastructure/auth/JwtService';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { ProjectService } from '../project/ProjectService';
import type { TaskService } from '../task/TaskService';

type Json = Record<string, unknown>;

export interface BuiltinCtx {
  db: Db;
  tenantId: number;
  projects: ProjectService;
  tasks: TaskService;
  /** Worker env — present when the caller threads it (needed by tools that
   *  decrypt integration credentials / reach external providers, e.g. migration). */
  env?: Env;
  /** Authed user id (createdBy on migration runs), when known. */
  userId?: string | null;
  /**
   * The CLOUD AGENT making this call (`ide_agents.id` / published ref), when the caller
   * is an agent rather than a person. Carried into the replay JWT as the signed `agt`
   * claim so a replayed WRITE is credited to the agent.
   *
   * The cloud-agent engine also passes this ref as `userId` (it is what `createdBy`
   * columns have always recorded for agent-authored rows, and changing that would
   * rewrite existing authorship). This field is what lets the replayed route tell the
   * two apart instead of reading an agent ref as a person.
   */
  agentRef?: string | null;
  /** The caller's role — used to mint a replay JWT for gateway-key callers. */
  role?: TenantRole;
  /** The caller's raw Bearer token — forwarded on route replay when it's a JWT
   *  (a real user) so the replayed route runs with the caller's exact identity. */
  authToken?: string | null;
  /** The request's ExecutionContext — passed to `app.request` so replayed routes'
   *  `waitUntil` side-effects don't throw. */
  executionCtx?: ExecutionContext;
}

/**
 * Run a platform action by REPLAYING the real `/api/*` route in-process (reuses
 * its logic AND its role-gate authz — the single source of truth). Forwards the
 * caller's JWT when present (real-user identity/role/segment); mints a short-lived
 * tenant JWT for gateway-key callers (bfk_/bfa_). Used for the heavy/computed/auth
 * tail that isn't a simple table op (executions dispatch, decks, analytics, …).
 */
export async function replayRoute(
  ctx: BuiltinCtx,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: Json,
  /** Send `body.text` as a raw text/plain body instead of JSON (e.g. project file
   *  contents, whose route reads `c.req.text()`). */
  opts?: { rawText?: string },
): Promise<unknown> {
  if (!ctx.env) throw new Error('route replay unavailable in this context');
  // Dynamic import avoids a static import cycle (index → routes → this module).
  const { buildApp } = await import('../../index');
  const app = buildApp(ctx.env);
  const auth = resolveReplayAuth({
    authToken: ctx.authToken,
    agentRef: ctx.agentRef,
  });
  const bearer = auth.forwardToken
    ? auth.forwardToken
    : await signJwt(
        {
          sub: auth.subject,
          tid: ctx.tenantId,
          role: ctx.role ?? TenantRole.DEVELOPER,
          // Signed authorship: when an AGENT is driving this call, the replayed route
          // credits the agent instead of mistaking its ref in `sub` for a user id.
          ...(ctx.agentRef ? { agt: ctx.agentRef } : {}),
        },
        ctx.env.JWT_SECRET,
      );
  const headers: Record<string, string> = { authorization: `Bearer ${bearer}` };
  const rawText = opts?.rawText;
  if (rawText !== undefined) headers['content-type'] = 'text/plain';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`https://internal${path}`, {
    method,
    headers,
    body: rawText !== undefined ? rawText : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const noopCtx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const res = await app.request(req, {}, ctx.env, ctx.executionCtx ?? noopCtx);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const detail = typeof parsed === 'object' && parsed ? JSON.stringify(parsed) : String(parsed);
    throw new Error(`${method} ${path} → ${res.status} ${detail}`.slice(0, 400));
  }
  return parsed;
}

export interface ReplayAuthPlan {
  /** A real person's still-authoritative bearer token. Never set for an agent run. */
  forwardToken?: string;
  /** Machine subject used when the platform must mint a fresh in-process token. */
  subject: 'agentHost:mcp';
}

/**
 * Decide how an in-process route replay authenticates.
 *
 * Cloud agents must never inherit the web/session JWT that happened to launch a
 * run. A run can outlive that token, and an agent UUID is not a user with an
 * `auth_tokens` row. Minting a fresh machine token per replay keeps the call
 * bounded by the run's tenant/role while the signed `agt` claim above preserves
 * the real agent authorship. Human MCP calls still forward their bearer so
 * session revocation and exact user permissions remain authoritative.
 */
export function resolveReplayAuth(args: {
  authToken?: string | null;
  agentRef?: string | null;
}): ReplayAuthPlan {
  const token = args.authToken?.trim() ?? '';
  const isGatewayKey = /^(bfk_|bfa_|clk_)/.test(token);
  if (!args.agentRef && token && !isGatewayKey) {
    return { forwardToken: token, subject: 'agentHost:mcp' };
  }
  return { subject: 'agentHost:mcp' };
}

/**
 * One catalog row.
 *
 * Exported (with {@link BuiltinCtx} and {@link replayRoute}) so a large, self-contained
 * domain can declare its own rows in its own module and be spread into `CATALOG` — the
 * career tools do exactly that. The import is type-only in that direction, so there is
 * no runtime cycle; the catalog stays the single advertised source either way.
 */
export interface BuiltinTool {
  /** `<domain>.<method>` — the relay name passed back on /v1/mcp/call. */
  tool: string;
  description: string;
  parameters: Json;
  /** Whether the tool changes state (parity with the frontend manifest). */
  mutates: boolean;
  run: (ctx: BuiltinCtx, args: Json) => Promise<unknown>;
}
