/**
 * runPendingRedemptionSweep — re-signals the KV-gated cron tick while a pending redemption is
 * still being retried, and goes quiet when none is (or when the stragglers are too old to be
 * worth a hot tick: the floor sweep retries those).
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeCronKv } from '../runtime/__fixtures__/fakeCronKv';

vi.mock('./aiCredits', () => ({ grantAiCredits: vi.fn(async () => true) }));

import { runPendingRedemptionSweep } from './redeemPoints';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/**
 * sweep read = where().orderBy().limit(); per-row re-read = where().limit(1), once per swept row;
 * the young-pending probe = where().limit(1) after the last re-read (so it is the call that follows
 * `sweepRows.length` re-reads).
 */
function dbWith(sweepRows: Array<Record<string, unknown>>, pendingRow: Record<string, unknown> | null, youngPending = false) {
  let limitCalls = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => sweepRows }),
          limit: async () => {
            const call = limitCalls;
            limitCalls += 1;
            if (call < sweepRows.length) return pendingRow ? [pendingRow] : [];
            return youngPending ? [{ id: 99 }] : [];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as never;
}

describe('runPendingRedemptionSweep — cron gate', () => {
  it('signals while a pending redemption failed to fulfil this pass (it is retried next tick)', async () => {
    const { env, signalled } = fakeCronKv();
    // An unknown SKU cannot be fulfilled, so the row stays pending.
    const db = dbWith([{ id: 1, tenantId: 1, createdAt: minutesAgo(20) }], { status: 'pending', rewardKey: 'gone_sku', memberRef: 'u1' });
    const r = await runPendingRedemptionSweep(db, env);
    expect(r).toEqual({ scanned: 1, fulfilled: 0 });
    expect(signalled()).toBe(true);
  });

  it('does NOT signal once every pending redemption fulfilled', async () => {
    const { env, signalled } = fakeCronKv();
    const db = dbWith([{ id: 1, tenantId: 1, createdAt: minutesAgo(20) }], { status: 'pending', rewardKey: 'ai_tokens_100k', memberRef: 'u1' });
    const r = await runPendingRedemptionSweep(db, env);
    expect(r.fulfilled).toBe(1);
    expect(signalled()).toBe(false);
  });

  it('signals while a pending redemption is still younger than the retry threshold', async () => {
    const { env, signalled } = fakeCronKv();
    const r = await runPendingRedemptionSweep(dbWith([], null, true), env);
    expect(r).toEqual({ scanned: 0, fulfilled: 0 });
    expect(signalled()).toBe(true);
  });

  it('does NOT signal when no redemption is pending', async () => {
    const { env, signalled } = fakeCronKv();
    await runPendingRedemptionSweep(dbWith([], null), env);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for a redemption that can never fulfil once it is past the signal window', async () => {
    const { env, signalled } = fakeCronKv();
    const db = dbWith([{ id: 1, tenantId: 1, createdAt: minutesAgo(3 * 60) }], { status: 'pending', rewardKey: 'gone_sku', memberRef: 'u1' });
    await runPendingRedemptionSweep(db, env);
    expect(signalled()).toBe(false);
  });
});
