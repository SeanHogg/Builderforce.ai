/**
 * The RouteReplay PORT — how a builtin MCP tool call replays an `/api/*` route.
 *
 * WHY A PORT: `application/llm/replayApp.ts` dynamically imported `index.ts`
 * (the composition root), so ANY Worker that reached this import bundled the
 * entire API. That blocked the Gateway Worker split (PRD 39 §1): a builtin
 * tool call reaching the replay import pulled in all ~280 app.route mounts
 * and every Durable Object class, saving nothing.
 *
 * A first-party MCP tool replays an `/api/*` route in-process to reuse its
 * logic AND role-gate authz. The PORT abstracts WHERE that replay is served:
 *
 *  - `builderforce-api` binds it to the IN-PROCESS app (`resolveApp`).
 *  - `builderforce-gateway` binds it to the `env.API` SERVICE BINDING
 *    (`env.API.fetch(request)`), because the gateway Worker must never import
 *    the composition root.
 *
 * `builtinToolContext.ts` depends ONLY on this port — never on `index.ts`.
 */
import type { Env } from '../../env';

/**
 * Replay an in-process request and return its response.
 *
 * The caller builds a fully-formed Request (path, method, headers, body) and
 * hands it here. On the API Worker this dispatches through the whole Hono app;
 * on the gateway Worker this forwards the exact request over the service
 * binding. Either way the replayed route runs with the caller's identity.
 */
export interface RouteReplay {
  (request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

/**
 * The binding the CURRENT Worker installed for the port.
 *
 * Each entry point configures this ONCE at module load:
 *  - `builderforce-api` (src/index.ts) binds {@link ./replayApp.inProcessRouteReplay}.
 *  - `builderforce-gateway` (src/gatewayWorker.ts) binds a closure over its `API`
 *    service binding.
 *
 * It is module state rather than a constructor parameter because the callers that
 * replay routes (the builtin tool catalog) are reached from many places — the REST
 * relay, the cloud-agent engine, the Brain reply loop — and threading a binding
 * through every one would touch code that has no other reason to change. A Worker
 * isolate runs a single entry, so one binding per isolate is exactly right.
 */
let configuredBinding: RouteReplay | undefined;

/** Install (or replace) this Worker's RouteReplay binding. Called once by the entry. */
export function configureRouteReplay(binding: RouteReplay | undefined): void {
  configuredBinding = binding;
}

/**
 * The binding a replay should use: an explicit per-call override wins, else the
 * Worker's configured binding. Undefined means nobody bound the port (a unit test
 * that never loaded an entry) — callers treat that as "replay unavailable".
 */
export function resolveRouteReplay(override?: RouteReplay): RouteReplay | undefined {
  return override ?? configuredBinding;
}
