/**
 * `EscalationService.evaluateIncident` — the REAL return value the escalation sweep keys its cron
 * signal off. `runEscalationSweep.test.ts` stubs this method (it is proving the sweep's signalling,
 * not the paging), which leaves the value the sweep consumes unproven: a wrong `nextLevelDueAtMs`
 * would either hold the gate open for an exhausted ladder or leave a due level waiting for the floor.
 * Only the notifier is replaced; the policy resolution, the due-level choice and the next-due
 * arithmetic are the real code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const notifyIncident = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('./incidentNotifier', () => ({ notifyIncident: (...args: unknown[]) => notifyIncident(...args) }));
vi.mock('./incidentDispatch', () => ({ dispatchIncidentTriage: vi.fn(async () => false) }));

import { EscalationService } from './EscalationService';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

const level = (n: number, afterMinutes: number) => ({
  id: `l${n}`, tenantId: 1, policyId: 'p1', level: n, afterMinutes,
  targetKind: 'user', targetRef: `${n}`, notifyTeams: true, notifySlack: true, notifyEmail: true,
});
const LADDER = [level(1, 0), level(2, 15), level(3, 45)];

/** An incident that started `ageMin` minutes ago and has reached `reached`. */
const incident = (ageMin: number, reached: number, over: Record<string, unknown> = {}) => ({
  id: 'inc-1', tenantId: 1, title: 'Checkout down', severity: 'sev1', status: 'open', affectedSystem: null,
  escalationPolicyId: 'p1', escalationLevel: reached, startedAt: new Date(NOW - ageMin * MIN), boardTaskId: null, ...over,
}) as never;

const env = {} as Env;
/** The pinned policy skips the policy lookup, so the first (and only) read is the ladder. */
const evaluate = (inc: never, ladder: unknown[] = LADDER) => {
  const db = fakeDb([ladder, [], []]);
  return { db, result: new EscalationService(db as unknown as Db).evaluateIncident(env, 1, inc) };
};

beforeEach(() => {
  notifyIncident.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => { vi.useRealTimers(); });

describe('EscalationService.evaluateIncident — the value the sweep signals from', () => {
  it('pages the due level and reports when the level AFTER it is due', async () => {
    // 20 minutes in, level 1 reached: level 2 (15m) is due, level 3 (45m) is the next rung.
    const { result } = evaluate(incident(20, 1));
    await expect(result).resolves.toEqual({ escalated: true, nextLevelDueAtMs: NOW - 20 * MIN + 45 * MIN });
    expect(notifyIncident).toHaveBeenCalledTimes(1);
    expect(notifyIncident.mock.calls[0]![2]).toMatchObject({ level: 2 });
  });

  it('pages nothing and reports the next rung when no level is due yet', async () => {
    const { result } = evaluate(incident(5, 1));
    await expect(result).resolves.toEqual({ escalated: false, nextLevelDueAtMs: NOW - 5 * MIN + 15 * MIN });
    expect(notifyIncident).not.toHaveBeenCalled();
  });

  it('reports null once the top of the ladder has been paged, so an unacknowledged incident cannot hold the gate open', async () => {
    const paged = evaluate(incident(60, 2));
    await expect(paged.result).resolves.toEqual({ escalated: true, nextLevelDueAtMs: null });
    const exhausted = evaluate(incident(600, 3));
    await expect(exhausted.result).resolves.toEqual({ escalated: false, nextLevelDueAtMs: null });
  });

  it('fires only ONE level per step even when several timers have elapsed', async () => {
    // 60 minutes in with only level 1 reached: levels 2 and 3 are both overdue, level 2 goes first.
    const { result } = evaluate(incident(60, 1));
    await expect(result).resolves.toEqual({ escalated: true, nextLevelDueAtMs: NOW - 60 * MIN + 45 * MIN });
    expect(notifyIncident).toHaveBeenCalledTimes(1);
  });

  it.each(['acknowledged', 'mitigated', 'resolved'])('is idle for a %s incident, without reading the policy', async (status) => {
    const { db, result } = evaluate(incident(120, 1, { status }));
    await expect(result).resolves.toEqual({ escalated: false, nextLevelDueAtMs: null });
    expect(db.calls).toHaveLength(0);
  });

  it('is idle for an incident whose policy has no levels', async () => {
    const { result } = evaluate(incident(120, 0), []);
    await expect(result).resolves.toEqual({ escalated: false, nextLevelDueAtMs: null });
    expect(notifyIncident).not.toHaveBeenCalled();
  });
});
