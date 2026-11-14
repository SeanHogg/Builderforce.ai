/**
 * The API-Worker binding of the {@link RouteReplay} port — the in-process app.
 *
 * A builtin MCP tool call replays an `/api/*` route in-process so the replay
 * reuses the route's logic AND role-gate authz (the single source of truth).
 * This adapter satisfies the port by dispatching the replayed request through
 * the whole Hono app — but ONLY on `builderforce-api`.
 *
 * The dynamic import of `index.ts` (the composition root) is INTENTIONAL here:
 * this module is the API side of the port and only ever loads inside the API
 * Worker, which already bundles `index.ts`. The GATEWAY Worker never imports
 * this file — it binds the port to `env.API.fetch(request)` instead (see
 * `configureRouteReplay` in src/gatewayWorker.ts). Keeping the
 * `import('../../index')` dynamic (rather than static) preserves the existing
 * module-graph shape: `index → routes → builtinToolContext`, with the cycle
 * broken by the deferral, and lets a unit test stub THIS module without loading
 * the composition root (a hoisted `vi.mock('../../index')` does not intercept
 * the dynamic import under the API package's Vitest 4).
 *
 * Lives in application/ (not presentation/appCache) so the API entry can import
 * it without an inner-layer → presentation import.
 */
import type { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { RouteReplay } from './routeReplay';

export async function loadReplayApp(env: Env): Promise<Hono<HonoEnv>> {
  const { resolveApp } = await import('../../index');
  return resolveApp(env);
}

/**
 * The {@link RouteReplay} binding for `builderforce-api`: replay in-process
 * through the whole app. The replayed request is handed straight to
 * `app.request`, so an in-process replay token never leaves the isolate.
 */
export const inProcessRouteReplay: RouteReplay = async (request, env, ctx) => {
  const app = await loadReplayApp(env);
  return app.request(request, {}, env, ctx);
};
