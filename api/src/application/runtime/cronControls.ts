import type { Env } from '../../env';
import type { CronSweepDef } from './cronSweepRunner';

/**
 * Platform-wide kill switches for scheduled work. Stored in KV so the cron path can
 * inspect them without waking Postgres. Missing/corrupt state fails open: existing
 * deployments keep running until an operator explicitly disables a sweep.
 */
export const CRON_CONTROLS_KV_KEY = 'cron-controls:v1';

export type CronControlState = Record<string, boolean>;

export async function readCronControls(env: Pick<Env, 'AUTH_CACHE_KV'>): Promise<CronControlState> {
  if (!env.AUTH_CACHE_KV) return {};
  try {
    const value = await env.AUTH_CACHE_KV.get(CRON_CONTROLS_KV_KEY, 'json');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([, enabled]) => typeof enabled === 'boolean'),
    ) as CronControlState;
  } catch {
    // A control-plane outage must not silently turn off maintenance and safety jobs.
    return {};
  }
}

export function cronSweepEnabled(controls: CronControlState, key: string): boolean {
  return controls[key] !== false;
}

/** Compose the persisted switch with a sweep's environment availability predicate. */
export function applyCronControls(
  defs: readonly CronSweepDef[],
  controls: CronControlState,
): CronSweepDef[] {
  return defs.map((def) => ({
    ...def,
    available: (env: Env) => cronSweepEnabled(controls, def.key) && (def.available?.(env) ?? true),
  }));
}

export async function writeCronControl(
  env: Pick<Env, 'AUTH_CACHE_KV'>,
  key: string,
  enabled: boolean,
): Promise<CronControlState> {
  if (!env.AUTH_CACHE_KV) throw new Error('AUTH_CACHE_KV is not bound; cron controls cannot be persisted.');
  const controls = await readCronControls(env);
  controls[key] = enabled;
  await env.AUTH_CACHE_KV.put(CRON_CONTROLS_KV_KEY, JSON.stringify(controls));
  return controls;
}
