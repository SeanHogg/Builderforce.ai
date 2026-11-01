/**
 * Test fixture: an in-memory KV plus an env carrying it, so a sweep test can assert the ONE thing
 * the cron gate cares about — did this pass leave a pending-work signal behind? — against the real
 * `signalPendingWork` rather than a mock of it. Shared by every "re-signals while timed work
 * remains" test so the key name lives in one place.
 */
import type { Env } from '../../../env';

/** The key `signalPendingWork` writes (see cronWorkSignal.ts). */
const WORK_SIGNAL_KEY = 'cron:work-pending';

export function fakeCronKv(extraEnv: Partial<Env> = {}) {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
  return {
    env: { AUTH_CACHE_KV: kv, ...extraEnv } as Env,
    store,
    /** True when the pass under test armed the next tick. */
    signalled: () => store.has(WORK_SIGNAL_KEY),
  };
}
