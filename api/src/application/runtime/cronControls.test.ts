import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { applyCronControls, cronSweepEnabled, readCronControls, writeCronControl } from './cronControls';
import type { CronSweepDef } from './cronSweepRunner';

const def = (key: string, available?: (env: Env) => boolean): CronSweepDef => ({
  key, cadence: 'frequent', description: `${key} test sweep`, available, run: async () => null,
});

describe('cron controls', () => {
  it('defaults every unmentioned sweep on and composes with environment availability', () => {
    expect(cronSweepEnabled({}, 'manager')).toBe(true);
    const [off, envOff] = applyCronControls(
      [def('manager'), def('demo-reseed', () => false)],
      { manager: false },
    );
    expect(off!.available!({} as Env)).toBe(false);
    expect(envOff!.available!({} as Env)).toBe(false);
  });

  it('fails open when KV is absent or contains invalid data', async () => {
    expect(await readCronControls({})).toEqual({});
    const get = vi.fn().mockResolvedValue(['not', 'a map']);
    expect(await readCronControls({ AUTH_CACHE_KV: { get } as unknown as KVNamespace })).toEqual({});
  });

  it('persists one switch without losing the others', async () => {
    const put = vi.fn();
    const kv = { get: vi.fn().mockResolvedValue({ manager: false }), put } as unknown as KVNamespace;
    const result = await writeCronControl({ AUTH_CACHE_KV: kv }, 'pr-ticket-reconciler', false);
    expect(result).toEqual({ manager: false, 'pr-ticket-reconciler': false });
    expect(put).toHaveBeenCalledWith('cron-controls:v1', JSON.stringify(result));
  });
});
