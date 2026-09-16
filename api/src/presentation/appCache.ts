/**
 * Per-isolate cache for the composition root.
 *
 * `buildApp(env)` constructs the ENTIRE surface — a Neon client, ~40 repositories
 * and application services, and 229 `app.route(...)` mounts. It used to run on
 * every single request, and a second time inside `replayRoute` for every builtin
 * MCP tool call an LLM turn makes, so one agent turn could rebuild the whole app
 * a dozen times.
 *
 * That is the failure this module exists to remove. A Worker isolate that
 * exceeds its CPU or memory ceiling is killed by the runtime BEFORE any JavaScript
 * runs — no `catch` fires, no middleware runs, and the browser receives Cloudflare's
 * Error 1101/1102 page, which carries NO `Access-Control-Allow-Origin` header. The
 * browser then reports the only thing it can see: "No 'Access-Control-Allow-Origin'
 * header is present" / `net::ERR_FAILED`, on every endpoint at once — which reads
 * as a CORS misconfiguration and is not one. The composition root is the largest
 * per-request cost in the worker, so it is the first thing to stop paying.
 *
 * Keyed by the `env` object itself (a WeakMap, so nothing is retained across
 * deployments or leaks in tests): the Workers runtime hands the same bindings
 * object to every request an isolate serves, and a DIFFERENT object — a test
 * harness, a staged binding set — correctly gets its own app rather than silently
 * reusing another environment's wiring.
 *
 * A throwing `build` is deliberately NOT cached: a composition root that failed on
 * a missing secret must be retried, not remembered.
 */
import type { Hono } from 'hono';
import type { Env, HonoEnv } from '../env';

let apps = new WeakMap<object, Hono<HonoEnv>>();

export function cachedApp(env: Env, build: (env: Env) => Hono<HonoEnv>): Hono<HonoEnv> {
  // A non-object env (never in production; possible in a hand-rolled test double)
  // simply skips the cache rather than throwing on WeakMap.get.
  if (env === null || typeof env !== 'object') return build(env);
  const key = env as unknown as object;
  const existing = apps.get(key);
  if (existing) return existing;
  const app = build(env);
  apps.set(key, app);
  return app;
}

/** Drop every cached app so one test's wiring cannot answer another test's request. */
export function resetAppCacheForTests(): void {
  apps = new WeakMap();
}
