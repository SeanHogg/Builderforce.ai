/**
 * builderforce-gateway — the Worker that serves the metered LLM surface
 * (`api.builderforce.ai/llm/*`, `api.builderforce.ai/v1/*`,
 * `builderforce.ai/gateway/llm/*`, `builderforce.ai/gateway/v1/*`).
 *
 * WHY A THIRD WORKER (PRD 39 §1): every `/llm` and `/v1` call used to boot the whole
 * API — ~21 MB of code, ~280 app.route mounts, every Durable Object class — just to
 * proxy a completion. This entry imports ONLY the gateway app (the LLM gateway, the
 * video routes and the semantic cache), so a cold start parses what an LLM call
 * needs and nothing else. A guard (`scripts/check-gateway-worker-graph.mjs`) fails
 * the build if that import graph ever reaches the API composition root (`src/index.ts`),
 * which would re-bundle everything and save nothing.
 *
 * ROUTING: the API keeps serving everything until push 2 (the mounts are NOT removed
 * from src/index.ts in this push), so this Worker is deployed with NO production
 * routes — it answers only on its `workers.dev` hostname. The same-origin gateway
 * prefix (`builderforce.ai/gateway/*`) is stripped with the SAME `stripGatewayPrefix`
 * the API uses (see presentation/gatewayPrefix.ts), so `/gateway/llm/*` matches the
 * `/llm` mounts identically on both Workers.
 *
 * ROUTE REPLAY: a builtin MCP tool call replays an `/api/*` route. On the API that
 * replays IN-PROCESS; here it MUST NOT import the composition root (it would bundle
 * the whole API). So this Worker binds the RouteReplay port to the `API` service
 * binding (`env.API.fetch`) — the replay goes over the binding exactly as the request
 * would have reached the API. See application/llm/routeReplay.ts.
 */
import type { Env } from './env';
import { stripGatewayPrefix } from './presentation/gatewayPrefix';
import { configureRouteReplay } from './application/llm/routeReplay';
import { configureCaughtErrorReporter } from './application/observability/caughtErrorReporter';
import { runInRequestScope } from './application/shared/requestScope';
import { persistCaughtError } from './infrastructure/observability/persistCaughtError';
import { configureDomainFailureSinks } from './application/observability/domainFailureSinks';
import { buildGatewayApp } from './presentation/gatewayApp';

configureCaughtErrorReporter(persistCaughtError);
configureDomainFailureSinks();

/** Env of the gateway Worker: the API service binding plus everything the gateway
 *  routes read (same bindings as the API for the buckets/namespaces they share). */
export interface GatewayWorkerEnv extends Env {
  /** Service binding back to the API Worker — the gateway side of the RouteReplay
   *  port, and where any non-gateway path falls through. */
  API: Fetcher;
}

export default {
  async fetch(rawRequest: Request, env: GatewayWorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // Bind the gateway side of the RouteReplay port BEFORE the app runs, so a
    // builtin tool call replays an `/api/*` route THROUGH THE SERVICE BINDING
    // rather than importing the composition root.
    configureRouteReplay((request, _env, _ctx) => env.API.fetch(request));

    // Same-origin gateway prefix (builderforce.ai/gateway/*) → the bare gateway
    // surface, so the mounts match whether the caller used the apex or the
    // api.* subdomain. No-op for direct api.builderforce.ai traffic.
    const request = stripGatewayPrefix(rawRequest);

    return runInRequestScope({
      env,
      method: request.method,
      path: new URL(request.url).pathname,
      waitUntil: (task) => ctx.waitUntil(task),
    }, async () => {
      const app = buildGatewayApp();
      return app.fetch(request, env, ctx);
    });
  },
};
