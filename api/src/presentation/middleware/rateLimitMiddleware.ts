import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Per-tenant API rate limiting middleware.
 *
 * Uses the TenantRateLimiterDO Durable Object (one instance per tenant) for a
 * sliding-window rate limit.  Falls back gracefully if the DO binding is not
 * configured (e.g. in local dev).
 *
 * Default limits per plan (requests per minute), one bucket per tenant:
 *   FREE   →  300  rpm
 *   PRO    → 1200  rpm
 *   TEAMS  → 3000  rpm
 *
 * Board fan-out writes count against a separate key at 4× those limits so they
 * cannot empty the bucket a human tab shares. They are not exempt — see
 * BOARD_RPM_MULTIPLIER. The buckets, their keys and the documented total ceiling
 * (5× plan rpm in requests, plus the chat-dispatch window) live in
 * `application/ratelimit/tenantBuckets.ts`.
 *
 * A board write that arrives through the MCP relay (`POST /llm/v1/mcp/call` naming
 * tasks.create / tasks.update / chats.link_ticket …), or a JSON-RPC `tools/call` on
 * `/mcp` naming the same tool, is classified by the tool in the body, not the path —
 * see MCP_CALL_ROUTE.
 *
 * Returns HTTP 429 with Retry-After header when the limit is exceeded.
 *
 * Usage:
 *   import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
 *   router.use('*', rateLimitMiddleware);
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { TenantPlan } from '../../domain/shared/types';
import { checkSlidingWindow } from '../../application/ratelimit/slidingWindow';
import {
  BOARD_RPM_MULTIPLIER, RPM_LIMITS, boardBucketKey, resolvePlanRpm, tenantBucketKey,
} from '../../application/ratelimit/tenantBuckets';
import { BUILTIN_EXTENSION_ID, advertisedName } from '../../application/llm/toolNaming';
import { resolveBearerTenantId } from '../routes/llmRoutes';

/** Requests the limiter never counts or blocks AT THE DOOR. Persisting a chat turn is
 *  the user's own work — a 429 there drops the turn ("Could not save the turn"), so the
 *  plain persist must not share the tenant bucket with polling/abuse traffic (operator,
 *  2026-10-18). Still authenticated by the router's own authMiddleware.
 *
 *  Exempt here is NOT unthrottled: the same POST can fan out a directed-agent reply
 *  (an LLM call) per `addressedTo` agent and a notify (in-app + email) per mentioned
 *  human. The handler spends those against `${tenantId}:dispatch` itself
 *  (`consumeDispatchBudget`), since only it knows the fan-out size; an over-budget
 *  turn is still saved, its fan-out is skipped and reported. Add routes here as DATA. */
const EXEMPT_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'POST', path: /^\/api\/brain\/chats\/[^/]+\/messages\/?$/ },
];

export function isRateLimitExempt(method: string, path: string): boolean {
  return EXEMPT_ROUTES.some((r) => r.method === method.toUpperCase() && r.path.test(path));
}

/**
 * Board fan-out writes do not share the tenant bucket a human tab uses.
 *
 * A chat that files a set of tickets — create, materialize's N children, N
 * role-run dispatches, the chat↔ticket link — spends the same sliding window
 * as the signed-in UI. Production (operator, 2026-10-18): twelve tickets filled
 * the FREE window and every later create, and the human in that tenant, got
 * 429 `Rate limit exceeded. Please slow down.` for the rest of the turn.
 *
 * These routes are NOT added to EXEMPT_ROUTES. Ticket create, materialize, and
 * run-now / executions write durable rows and start billable runs. A blanket
 * exemption would let a stolen bearer do that with no throttle — a real
 * vulnerability, not a nicety. They stay capped. (Persisting a chat turn can
 * also start billable work — directed agent replies — which is why that work is
 * spent against the dispatch bucket in the handler; see EXEMPT_ROUTES.)
 *
 * They count against `${tenantId}:board` through the same checkSlidingWindow
 * primitive, at BOARD_RPM_MULTIPLIER × the plan rpm (FREE 1200, PRO 4800,
 * TEAMS 12000). That fits the fan-out that exhausted the shared 300 window,
 * with headroom, and it is still a hard cap (~20 writes/sec on FREE). Board
 * writes are NOT also counted against the tenant key (that would put the
 * fan-out back into the human's window), so the tenant's total request
 * ceiling is 5× plan rpm — documented in tenantBuckets.ts. The
 * ordinary key stays `String(tenantId)` so an in-flight tenant window is not
 * forked. Reads, and every route not listed here, stay on that window at the
 * plan rpm — including LLM, telemetry, and brain routes other than the one
 * link POST.
 *
 * Prefixes use a `(?:/|$)` boundary so `/api/boards` does not swallow
 * `/api/engagement-board` and `/api/tasks` does not swallow a sibling path.
 * The two exact routes are the fan-out doors that live outside those prefixes
 * (role-run create, chat↔ticket link). Neighbouring writes on the same
 * routers — execution telemetry, cancel, brain summarize — stay on the plan rpm.
 */
const BOARD_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Mutation prefixes. Reads on these paths stay on the tenant bucket. */
const BOARD_MUTATION_PREFIXES: readonly RegExp[] = [
  /^\/api\/tasks(?:\/|$)/,
  /^\/api\/kanban(?:\/|$)/,
  /^\/api\/boards(?:\/|$)/,
];

/** Fan-out doors outside the prefixes. Exact, so a neighbour stays throttled. */
const BOARD_MUTATION_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'POST', path: /^\/api\/runtime\/executions\/?$/ },
  { method: 'POST', path: /^\/api\/brain\/chats\/[^/]+\/tickets\/?$/ },
];

export function isBoardMutation(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (BOARD_MUTATION_ROUTES.some((r) => r.method === m && r.path.test(path))) return true;
  if (!BOARD_MUTATION_METHODS.has(m)) return false;
  return BOARD_MUTATION_PREFIXES.some((re) => re.test(path));
}

/**
 * The MCP relay door (`POST /llm/v1/mcp/call`, and `/v1/mcp/call`) every `builtin_*` tool
 * call goes through — the web Brain's and the editor's alike. The path says nothing
 * about the work, so the TOOL named in the body decides: a board-write tool is the same
 * fan-out as the REST routes above (a chat filing tickets = N creates + N links) and
 * spends the board bucket, not the human's 1× window.
 */
const MCP_CALL_ROUTE = /^\/(?:llm\/)?v1\/mcp\/call\/?$/;

/** Relay tool names (`<domain>.<method>` on the `builtin` extension) that write the board. Data, not branches. */
const BOARD_MUTATION_MCP_TOOLS: ReadonlySet<string> = new Set([
  'tasks.create',
  'tasks.update',
  'tasks.move',
  'tasks.delete',
  'chats.link_ticket',
  'chats.unlink_ticket',
  'tickets.from_delta',
]);

/** Whether a relay call body names a board-write builtin tool. */
export function isBoardMutationMcpCall(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const { extensionId, tool } = body as { extensionId?: unknown; tool?: unknown };
  return extensionId === BUILTIN_EXTENSION_ID && typeof tool === 'string' && BOARD_MUTATION_MCP_TOOLS.has(tool);
}

/** The remote MCP server (`POST /mcp`, JSON-RPC) — it names tools by their flat advertised name. */
const MCP_JSONRPC_ROUTE = /^\/mcp\/?$/;

/** The same set, spelled as the JSON-RPC route's `params.name` (`builtin_tasks_create`). Derived, never a second list. */
const BOARD_MUTATION_ADVERTISED_NAMES: ReadonlySet<string> = new Set([...BOARD_MUTATION_MCP_TOOLS].map(advertisedName));

/**
 * Whether a JSON-RPC body (one request or a batch) holds a `tools/call` of a board-write
 * builtin tool. One such call in a batch charges the whole POST to the board bucket.
 */
export function isBoardMutationJsonRpc(body: unknown): boolean {
  const requests = Array.isArray(body) ? body : [body];
  return requests.some((request) => {
    if (!request || typeof request !== 'object') return false;
    const { method, params } = request as { method?: unknown; params?: { name?: unknown } | null };
    return method === 'tools/call' && typeof params?.name === 'string' && BOARD_MUTATION_ADVERTISED_NAMES.has(params.name);
  });
}

/**
 * The tool-call routes and their bodies, when this request is one (the relay `/v1/mcp/call`
 * or the JSON-RPC `/mcp`). `c.req.json()` is cached by Hono, so reading it here leaves
 * the body intact for the route's own parse.
 */
async function isBoardMutationRelayCall(c: Parameters<MiddlewareHandler>[0]): Promise<boolean> {
  if (c.req.method.toUpperCase() !== 'POST') return false;
  const relay = MCP_CALL_ROUTE.test(c.req.path);
  if (!relay && !MCP_JSONRPC_ROUTE.test(c.req.path)) return false;
  try {
    const body = await c.req.json();
    return relay ? isBoardMutationMcpCall(body) : isBoardMutationJsonRpc(body);
  } catch {
    return false; // not JSON — the route answers its own 400
  }
}

type RateLimitHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    TENANT_RATE_LIMITER?: DurableObjectNamespace;
  };
};

export const rateLimitMiddleware: MiddlewareHandler<RateLimitHonoEnv> = async (c, next) => {
  const env = c.env;

  // DO binding is optional — skip in dev/environments without it
  if (!env.TENANT_RATE_LIMITER || isRateLimitExempt(c.req.method, c.req.path)) {
    return next();
  }

  // tenantId is normally NOT in context yet: index.ts mounts this app-wide, ahead of
  // the routers whose own authMiddleware sets it. So it is resolved here from the
  // request's Bearer credential. Resolution reuses the gateway's OWN
  // key resolver (`resolveBearerTenantId` → `resolveKeyCached`), so machine keys
  // (`bfk_*`/`bfa_*`/`clk_*`) get a per-tenant limit too — previously any non-JWT
  // bearer skipped the limiter entirely, leaving the metered LLM gateway
  // unthrottled. Cache-backed (KV): a hit is ~1ms and shares the same cache entry
  // the route's own auth then reuses, so this adds no extra DB round-trip on the
  // hot path. Truly anonymous callers (no bearer / unresolvable) return null and
  // fall through un-throttled — public ingest paths depend on that.
  let tenantId = (c.get as (k: string) => unknown)('tenantId') as number | undefined;
  if (!tenantId) {
    const resolved = await resolveBearerTenantId(c);
    if (resolved == null) return next(); // anonymous / unresolved — don't rate-limit
    tenantId = resolved;
  }
  if (!tenantId) return next();

  // Effective plan from the cached tenant snapshot (KV, 1h) — no DB round-trip on a
  // warm path. An unrecognised plan string falls back to FREE: an `undefined` limit
  // would make the DO's `current < limit` false and deny every request.
  let rpm = RPM_LIMITS[TenantPlan.FREE];
  try {
    rpm = await resolvePlanRpm(env, tenantId);
  } catch (error) {
    // Lookup error — allow request through rather than block (fail open), but say so.
    reportCaughtError(error, { source: 'presentation/middleware/rateLimitMiddleware.ts', operation: 'resolvePlanRpm' });
    return next();
  }

  // Call the rate limiter DO through the shared counter — the same primitive the
  // public `/hooks/*` ingress uses, so there is one implementation of "count this
  // request against a bucket" rather than two that can drift. Board fan-out
  // writes use a different key and a higher allowance (see BOARD_RPM_MULTIPLIER);
  // everything else keeps the tenant key and the plan rpm.
  const boardWrite = isBoardMutation(c.req.method, c.req.path) || await isBoardMutationRelayCall(c);
  const bucketKey = boardWrite ? boardBucketKey(tenantId) : tenantBucketKey(tenantId);
  const limit = boardWrite ? rpm * BOARD_RPM_MULTIPLIER : rpm;
  try {
    const data = await checkSlidingWindow(env, bucketKey, limit);
    if (!data) return next();

    // Always set rate limit headers
    c.header('X-RateLimit-Limit',     String(data.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, data.limit - data.current)));
    c.header('X-RateLimit-Reset',     data.resetAt);

    if (!data.allowed) {
      c.header('Retry-After', String(data.retryAfterSeconds));
      return c.json(
        { error: 'Rate limit exceeded. Please slow down.', resetAt: data.resetAt },
        429,
      );
    }
  } catch (error) {
    // DO unavailable — allow request through
  
    reportCaughtError(error, { source: "presentation/middleware/rateLimitMiddleware.ts", operation: "rateLimitMiddleware" });
  }

  return next();
};
