/**
 * The GATEWAY app — the metered LLM surface mounted identically on BOTH Workers
 * during the Gateway Worker split rollout (PRD 39 §1).
 *
 * WHY SHARED: push 1 deploys `builderforce-gateway` (src/gatewayWorker.ts) on its
 * `workers.dev` hostname with NO production routes, while `builderforce-api`
 * (src/index.ts) keeps serving everything. The mounts and middleware here are a
 * BYTE-FOR-BYTE MIRROR of the `/llm`, `/llm/v1/videos` and `/v1/semantic-cache`
 * mounts in index.ts (same routers, same order, same rate-limit + CORS middleware),
 * so a request sees an identical surface whichever Worker answers it. Push 2 removes
 * those mounts from index.ts and replaces them with a single `app.route` delegation
 * to THIS app, making the sharing structural instead of mirrored — until then the
 * two copies are kept identical by review, and `check-gateway-worker-graph.mjs`
 * guards the gateway side from ever reaching the composition root.
 *
 * ROUTE SET — `/llm`, `/llm/v1/videos`, `/v1/semantic-cache`:
 *
 *  - `/llm` (createLlmRoutes) is the OpenAI-compatible LLM proxy, including
 *    `/llm/v1/mcp/*` (the builtin tool relay). A builtin tool call that replays an
 *    `/api/*` route does NOT import the composition root: it goes through the
 *    RouteReplay port (application/llm/routeReplay.ts), which each Worker entry
 *    binds at module load — in-process on the API, `env.API.fetch` on the gateway.
 *  - `/llm/v1/videos` is async media generation (MediaJobDO, bound here via
 *    `script_name` to the API's class — see wrangler.gateway.toml).
 *  - `/v1` is NARROWED to `/v1/semantic-cache` alone. The seam routes
 *    (`createSeamRoutes`) were assessed per PRD 39 §1 and DO NOT move: they pull the
 *    request DB through `requestDb(c)`, the customer-feedback inbox, the
 *    webhook-subscription use case and the segment-lifecycle use case — a
 *    cross-domain slice of the API that cannot move cleanly without dragging the
 *    composition root back in. Per the PRD, "if the seam routes stay, only
 *    `/v1/semantic-cache` moves and the route list narrows to match."
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../env';
import { corsMiddleware, addCorsToResponse } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rateLimitMiddleware';
import { errorHandler } from './middleware/errorHandler';
import { runInRequestScope } from '../application/shared/requestScope';
import { createLlmRoutes } from './routes/llmRoutes';
import { createVideoRoutes } from './routes/videoRoutes';
import { createSemanticCacheRoutes } from './routes/semanticCacheRoutes';

/**
 * Build the gateway app. The RouteReplay binding is NOT a parameter: each Worker
 * entry configures the port once at module load (`configureRouteReplay`), so the
 * app itself stays identical on both Workers.
 */
export function buildGatewayApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.use('*', (c, next) => runInRequestScope({
    env: c.env,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  }, next));

  app.use('*', corsMiddleware);

  // Per-tenant sliding-window limit on the metered surface — the same limit the API
  // applies (`app.use('/llm/*'|'/v1/*', rateLimitMiddleware)` in index.ts), so a
  // request sees identical throttling whichever Worker answers it. Inert unless
  // TENANT_RATE_LIMITER is bound.
  app.use('/llm/*', rateLimitMiddleware as Parameters<typeof app.use>[1]);
  app.use('/v1/*', rateLimitMiddleware as Parameters<typeof app.use>[1]);

  // Video generation + server movie render — async media jobs. Mounted before the
  // generic `/llm` gateway so `/llm/v1/videos/*` resolves here (same order as index.ts).
  app.route('/llm/v1/videos', createVideoRoutes());
  app.route('/llm', createLlmRoutes());

  // The `/v1` surface the gateway owns: ONLY the semantic cache (the seam routes
  // stay on the API — see the module doc). The cache routes build their own DB
  // handle, so no `db` is threaded here.
  app.route('/v1/semantic-cache', createSemanticCacheRoutes());

  app.onError(errorHandler);
  app.notFound((c) => addCorsToResponse(c, c.json({ error: 'Not found' }, 404)));
  return app;
}
