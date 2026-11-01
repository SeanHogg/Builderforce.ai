/**
 * runEscalationSweep — keeps the KV-gated cron tick open while an unacknowledged incident still
 * has a level to fire, and goes quiet once the ladder is exhausted.
 *
 * `EscalationService.evaluateIncident` is stubbed (its paging path is not under test); the signal
 * is the REAL `signalPendingWork` against an in-memory KV.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fakeCronKv } from '../runtime/__fixtures__/fakeCronKv';
import { FLOOR_INTERVAL_MS } from '../runtime/cronWorkSignal';
import type { EscalationEvaluation } from './EscalationService';

const evaluate = vi.fn<(...a: unknown[]) => Promise<EscalationEvaluation>>();
vi.mock('./EscalationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./EscalationService')>()),
  EscalationService: class { evaluateIncident = (...a: unknown[]) => evaluate(...a); },
}));

import { runEscalationSweep } from './runEscalationSweep';
import { nextEscalationDueAtMs } from './EscalationService';

const dbWith = (incidents: Array<Record<string, unknown>>) => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => incidents }) }) }),
}) as never;

const OPEN = [{ id: 'inc-1', tenantId: 1 }];

beforeEach(() => { evaluate.mockReset(); });

describe('runEscalationSweep — cron gate', () => {
  it('signals while an open incident still has a further level due within the floor interval', async () => {
    const { env, signalled } = fakeCronKv();
    evaluate.mockResolvedValue({ escalated: true, nextLevelDueAtMs: Date.now() + 15 * 60_000 });
    const r = await runEscalationSweep(env, dbWith(OPEN));
    expect(r.escalated).toBe(1);
    expect(signalled()).toBe(true);
  });

  it('does NOT signal once the ladder is exhausted, so an unacknowledged incident cannot hold the gate open', async () => {
    const { env, signalled } = fakeCronKv();
    evaluate.mockResolvedValue({ escalated: true, nextLevelDueAtMs: null });
    await runEscalationSweep(env, dbWith(OPEN));
    expect(signalled()).toBe(false);
  });

  it('does NOT signal when no incident is open', async () => {
    const { env, signalled } = fakeCronKv();
    await runEscalationSweep(env, dbWith([]));
    expect(signalled()).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('leaves a level further out than the floor interval to the floor sweep', async () => {
    const { env, signalled } = fakeCronKv();
    evaluate.mockResolvedValue({ escalated: false, nextLevelDueAtMs: Date.now() + FLOOR_INTERVAL_MS + 10 * 60_000 });
    await runEscalationSweep(env, dbWith(OPEN));
    expect(signalled()).toBe(false);
  });

  it('keys the signal off the EARLIEST remaining level across incidents', async () => {
    const { env, signalled } = fakeCronKv();
    evaluate
      .mockResolvedValueOnce({ escalated: false, nextLevelDueAtMs: Date.now() + 5 * 3_600_000 })
      .mockResolvedValueOnce({ escalated: false, nextLevelDueAtMs: Date.now() + 5 * 60_000 });
    await runEscalationSweep(env, dbWith([{ id: 'a', tenantId: 1 }, { id: 'b', tenantId: 2 }]));
    expect(signalled()).toBe(true);
  });

  it('does not signal for an incident whose evaluation threw', async () => {
    const { env, signalled } = fakeCronKv();
    evaluate.mockRejectedValue(new Error('page failed'));
    await runEscalationSweep(env, dbWith(OPEN));
    expect(signalled()).toBe(false);
  });
});

describe('nextEscalationDueAtMs', () => {
  const started = new Date('2026-10-31T10:00:00Z');
  const ladder = [{ level: 1, afterMinutes: 0 }, { level: 2, afterMinutes: 15 }, { level: 3, afterMinutes: 45 }];

  it('is the start plus the earliest level above the one reached', () => {
    expect(nextEscalationDueAtMs(ladder, 1, started)).toBe(started.getTime() + 15 * 60_000);
    expect(nextEscalationDueAtMs(ladder, 2, started)).toBe(started.getTime() + 45 * 60_000);
  });

  it('is null once the top of the ladder is reached', () => {
    expect(nextEscalationDueAtMs(ladder, 3, started)).toBeNull();
    expect(nextEscalationDueAtMs([], 0, started)).toBeNull();
  });
});
