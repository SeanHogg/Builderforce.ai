/**
 * The Worker app used to replay an `/api/*` route in-process.
 *
 * A thin dynamic import of `resolveApp` so the replay helper does not statically
 * import `index.ts` (cycle: index → routes → builtinToolContext). Isolated here
 * so a unit test can stub THIS module without loading the composition root —
 * `vi.mock('../../index')` does not intercept the dynamic import under the API
 * package's Vitest 4, and the real `buildApp` then hangs the suite.
 *
 * Lives in application/ (not presentation/appCache) so `builtinToolContext` can
 * load it without an inner-layer → presentation import.
 */
import type { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';

export async function loadReplayApp(env: Env): Promise<Hono<HonoEnv>> {
  const { resolveApp } = await import('../../index');
  return resolveApp(env);
}
