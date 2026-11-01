/**
 * sweepIdlePreviews — re-signals the KV-gated cron tick while a lease still needs another pass,
 * and stays silent when none does. The signal is the real `signalPendingWork` on an in-memory KV.
 */
import { describe, expect, it } from 'vitest';
import { fakeCronKv } from './__fixtures__/fakeCronKv';
import { leaseNeedsSweep, sweepIdlePreviews, PREVIEW_IDLE_EVICTION_MS } from './previewSessions';

/** First select = the sweep's stale-lease read; second = the re-signal probe over live leases. */
function dbWith(stale: Array<Record<string, unknown>>, live: Array<Record<string, unknown>>) {
  const reads = [stale, live];
  return {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => reads.shift() ?? [] }) }) }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as never;
}

const ago = (ms: number) => new Date(Date.now() - ms);

describe('sweepIdlePreviews — cron gate', () => {
  it('signals while a watched lease remains (it will go idle within the eviction window)', async () => {
    const { env, signalled } = fakeCronKv();
    await sweepIdlePreviews(env, dbWith([], [{ lastSeenAt: ago(30_000), runStatus: 'running' }]));
    expect(signalled()).toBe(true);
  });

  it('signals while a lease whose run has finished is waiting to be evicted', async () => {
    const { env, signalled } = fakeCronKv();
    await sweepIdlePreviews(env, dbWith([], [{ lastSeenAt: ago(PREVIEW_IDLE_EVICTION_MS * 4), runStatus: 'completed' }]));
    expect(signalled()).toBe(true);
  });

  it('does NOT signal when no lease holds an instance', async () => {
    const { env, signalled } = fakeCronKv();
    await sweepIdlePreviews(env, dbWith([], []));
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for an unwatched lease whose run is still going (the run owns the instance)', async () => {
    const { env, signalled } = fakeCronKv();
    await sweepIdlePreviews(env, dbWith([], [{ lastSeenAt: ago(60 * 60_000), runStatus: 'running' }]));
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for the lease it just evicted', async () => {
    const { env, signalled } = fakeCronKv();
    const evictedNow = [{ tenantId: 1, executionId: 7, runStatus: 'completed' }];
    // After eviction the lease is no longer holding, so the probe sees nothing.
    const out = await sweepIdlePreviews(env, dbWith(evictedNow, []));
    expect(out.evicted).toBe(1);
    expect(signalled()).toBe(false);
  });
});

describe('leaseNeedsSweep', () => {
  const now = Date.now();
  it('is true for a recently touched lease and for a finished run, false for an unwatched live run', () => {
    expect(leaseNeedsSweep({ lastSeenAt: new Date(now - 1_000), runStatus: 'running' }, now)).toBe(true);
    expect(leaseNeedsSweep({ lastSeenAt: new Date(now - 3_600_000), runStatus: 'failed' }, now)).toBe(true);
    expect(leaseNeedsSweep({ lastSeenAt: new Date(now - 3_600_000), runStatus: 'running' }, now)).toBe(false);
  });
});
