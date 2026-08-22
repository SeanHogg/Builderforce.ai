import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { cachedApp, resetAppCacheForTests } from './appCache';
import type { Env, HonoEnv } from '../env';

/**
 * The composition root is the largest per-request cost in the worker (a Neon
 * client, ~40 services, 229 route mounts). Paying it once per isolate instead of
 * once per request — and once per builtin MCP tool call — is what keeps an LLM
 * turn from pushing the isolate into the CPU/memory ceiling, where the runtime
 * kills it and Cloudflare returns a HEADERLESS 1101/1102 page that every browser
 * reports as a CORS failure on every endpoint.
 */
describe('cachedApp', () => {
  beforeEach(() => resetAppCacheForTests());

  const envA = { CORS_ORIGINS: '*' } as unknown as Env;
  const envB = { CORS_ORIGINS: '*' } as unknown as Env;

  it('builds once per env and reuses the instance', () => {
    let builds = 0;
    const build = () => { builds += 1; return new Hono<HonoEnv>(); };

    const first = cachedApp(envA, build);
    const second = cachedApp(envA, build);

    expect(builds).toBe(1);
    expect(second).toBe(first);
  });

  it('keeps a different bindings object on its own app', () => {
    const build = () => new Hono<HonoEnv>();
    expect(cachedApp(envB, build)).not.toBe(cachedApp(envA, build));
  });

  it('does NOT cache a failed build, so a missing secret is retried', () => {
    let builds = 0;
    const failing = () => { builds += 1; throw new Error('NEON_DATABASE_URL is not set'); };

    expect(() => cachedApp(envA, failing)).toThrow('NEON_DATABASE_URL is not set');
    expect(() => cachedApp(envA, failing)).toThrow('NEON_DATABASE_URL is not set');
    expect(builds).toBe(2);

    // …and once it succeeds, the working app is the one that sticks.
    const app = cachedApp(envA, () => new Hono<HonoEnv>());
    expect(cachedApp(envA, failing)).toBe(app);
  });

  it('falls back to building when env is not an object', () => {
    const build = () => new Hono<HonoEnv>();
    expect(cachedApp(null as unknown as Env, build)).not.toBe(cachedApp(null as unknown as Env, build));
  });
});
