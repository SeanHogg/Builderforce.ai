/**
 * legacyAlias — mark a route mount that only exists for already-deployed callers.
 *
 * The agent-host router is mounted three times: its real path plus two aliases
 * kept alive because agents shipped before the rebrand still call them. Three
 * copies of a mount with three prose comments is not a migration plan — nothing
 * says WHICH alias is still in use, so nothing can ever be removed safely.
 *
 * A response from an alias carries the standard deprecation signals instead:
 *
 *   Deprecation: true                         (RFC 8594)
 *   Link: <canonical>; rel="successor-version"
 *
 * so an operator can see, from the caller's own logs, which fleet has not moved.
 */
import type { Context, Env as BaseEnv, Handler, Hono, MiddlewareHandler, Schema } from 'hono';
import type { HonoEnv } from '../../env';

/** The canonical agent-host mount. */
export const AGENT_HOST_BASE_PATH = '/api/agent-hosts';

/**
 * Deprecated mounts of the agent-host router, kept until the deployed fleet has
 * moved. `/api/claws` predates the BuilderForce Agents rebrand; `/api/agentNodes`
 * is what the agent-runtime's relay client targets for
 * `:id/{upstream,heartbeat,assignment-context}` — dropping it would 404 the
 * periodic heartbeat, and `lastSeenAt` going stale reads as "offline after 15
 * min" to the online-status rule (domain/agentHost/onlineStatus.ts).
 */
export const LEGACY_AGENT_HOST_PATHS = ['/api/claws', '/api/agentNodes'] as const;

/** The canonical managed-host mount (tenant waitlist + provisioning requests). */
export const MANAGED_AGENT_HOST_BASE_PATH = '/api/managed-agent-hosts';

/** `/api/managed-claws` predates the rebrand; published billing pages still call it. */
export const LEGACY_MANAGED_AGENT_HOST_PATHS = ['/api/managed-claws'] as const;

/**
 * Stamp the deprecation headers naming `canonical` as the successor path. Pass a
 * function when the alias is a single route with params, so the Link names the
 * concrete successor URL rather than a template.
 */
export function legacyAliasNotice(
  canonical: string | ((c: Context<HonoEnv>) => string),
): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    await next();
    const successor = typeof canonical === 'string' ? canonical : canonical(c);
    c.header('Deprecation', 'true');
    c.header('Link', `<${successor}>; rel="successor-version"`);
  };
}

/**
 * The ONE way a whole router gets legacy mounts: the canonical path once, then each
 * alias serving a fresh copy of the SAME router behind {@link legacyAliasNotice}.
 * A mount list instead of hand-copied `app.route` lines, so aliases cannot drift.
 */
export function mountWithLegacyAliases<SubEnv extends BaseEnv, SubSchema extends Schema, SubBasePath extends string>(
  app: Hono<HonoEnv>,
  canonical: string,
  aliases: readonly string[],
  // Generic like `Hono#route`, so a router with a widened env (agent hosts add the
  // relay binding) mounts without a cast.
  build: () => Hono<SubEnv, SubSchema, SubBasePath>,
): void {
  app.route(canonical, build());
  for (const alias of aliases) {
    app.use(`${alias}/*`, legacyAliasNotice(canonical));
    app.route(alias, build());
  }
}

/**
 * A single legacy PATH that is the same act as a canonical route on ANOTHER
 * router (e.g. `/marketplace/auth/login` → `/api/auth/web/login`).
 *
 * The request is re-dispatched into the app at the canonical path rather than
 * handled by a copy, so the alias runs the canonical route's whole chain — its
 * rate limit, its validation, its gates — and cannot drift from it. The response
 * carries the same `Deprecation` / successor `Link` as {@link legacyAliasNotice}.
 */
export function forwardToCanonical(app: Hono<HonoEnv>, canonical: string): Handler<HonoEnv> {
  return async (c) => {
    const target = new URL(c.req.url);
    target.pathname = canonical;
    // `executionCtx` throws in some test harnesses; the canonical route copes without it.
    let ctx: Parameters<Hono<HonoEnv>['fetch']>[2];
    try { ctx = c.executionCtx; } catch { ctx = undefined; }
    // The body is buffered rather than streamed across: alias bodies are small (auth
    // forms), and a buffered body needs no `duplex` handling in either runtime.
    const method = c.req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.raw.arrayBuffer();
    const forwarded = new Request(target, { method, headers: c.req.raw.headers, body });
    const res = await app.fetch(forwarded, c.env, ctx);
    const out = new Response(res.body, res);
    out.headers.set('Deprecation', 'true');
    out.headers.set('Link', `<${canonical}>; rel="successor-version"`);
    return out;
  };
}
