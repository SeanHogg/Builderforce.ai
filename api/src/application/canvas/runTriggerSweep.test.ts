import { describe, expect, it, vi } from 'vitest';
import { describeTransition, runTriggerSweep } from './runTriggerSweep';
import type { ResolvedTrigger } from '@builderforce/creation-canvas-contract';

vi.mock('../activity/activityLog', () => ({
  recordActivity: vi.fn(async () => {}),
}));
const { recordActivity } = await import('../activity/activityLog');

const NOW = Date.now();
/**
 * A deadline `n` whole days out, with half a day of slack.
 *
 * The sweep reads its own `Date.now()`, which is milliseconds later than this fixture's,
 * and `daysUntil` FLOORS — so an exact `NOW + 12 days` evaluates as 11 and the fixture
 * would appear to be off by one when the code is right. Half a day of slack puts every
 * case in the middle of its day instead of on the boundary.
 */
const inDays = (n: number) => new Date(NOW + n * 86_400_000 + 43_200_000).toISOString();

/**
 * A fake of the drizzle-neon builder chain this sweep uses, and only of it.
 *
 * Two reads (`selectDistinct(...).from().innerJoin().where().limit()` and
 * `select(...).from().where().limit()`) and one `execute`. Recording the execute rather
 * than interpreting it is deliberate: the assertion that matters is WHICH rows the sweep
 * decided to write, and re-implementing `jsonb ||` in a fake would be testing the fake.
 */
function fakeDb(sessions: unknown[], objects: unknown[]) {
  const executed: unknown[] = [];
  const reader = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'where']) chain[method] = () => chain;
    chain.limit = async () => rows;
    return chain;
  };
  return {
    executed,
    // The two reads are distinguishable by METHOD, not by call order: the session scan is
    // the only `selectDistinct`, so the object load is always `select`. Keying on a call
    // counter instead made the object read return sessions and every board come back
    // empty — the fake lying rather than the code failing.
    selectDistinct: () => reader(sessions),
    select: () => reader(objects),
    execute: async (statement: unknown) => { executed.push(statement); return { rowCount: 0 }; },
  };
}

const session = { id: 's1', tenantId: 7, title: 'Founder board' };

const trigger = (over: Record<string, unknown>) => ({
  id: over.id ?? 't1', sessionId: 's1', kind: 'trigger',
  content: { title: 'Renewal watch', watches: 'Acme MSA', comparator: 'due-within', threshold: 30, ...over },
});

const contract = (renewsAt: string | undefined) => ({
  id: 'c1', sessionId: 's1', kind: 'contract',
  content: { title: 'Acme MSA', ...(renewsAt ? { renewsAt } : {}) },
});

describe('runTriggerSweep', () => {
  it('does nothing when no board holds a trigger', async () => {
    const db = fakeDb([], []);
    const result = await runTriggerSweep({} as never, db as never);
    expect(result).toMatchObject({ boards: 0, evaluated: 0, changed: 0 });
    expect(db.executed).toHaveLength(0);
  });

  /** The whole point: a deadline inside the window breaches with nobody looking. */
  it('breaches a deadline trigger and logs the transition', async () => {
    const db = fakeDb([session], [contract(inDays(12)), trigger({ state: 'armed' })]);
    const result = await runTriggerSweep({} as never, db as never);

    expect(result).toMatchObject({ boards: 1, evaluated: 1, changed: 1, breached: 1, resolved: 0 });
    expect(db.executed).toHaveLength(1);
    expect(recordActivity).toHaveBeenCalledWith({}, db, expect.objectContaining({
      tenantId: 7,
      verb: 'trigger.breached',
      targetId: 't1',
      summary: expect.stringContaining('due in 12 days'),
    }));
  });

  /**
   * IDEMPOTENCE. A sweep that rewrote unchanged state would put one activity row per
   * trigger per day into the ledger forever, and an alert that repeats nightly is one
   * nobody reads by Friday.
   */
  it('writes nothing when the stored state already matches', async () => {
    const db = fakeDb([session], [contract(inDays(12)), trigger({ state: 'breached' })]);
    const result = await runTriggerSweep({} as never, db as never);
    expect(result).toMatchObject({ evaluated: 1, changed: 0, breached: 0 });
    expect(db.executed).toHaveLength(0);
  });

  /** Re-arming is news too — "the invoice was paid" is as worth logging as "it went
   *  overdue", and a ledger that only records bad news cannot show a resolution. */
  it('logs a re-arm when a breached trigger comes back inside its threshold', async () => {
    vi.mocked(recordActivity).mockClear();
    const db = fakeDb([session], [contract(inDays(90)), trigger({ state: 'breached' })]);
    const result = await runTriggerSweep({} as never, db as never);
    expect(result).toMatchObject({ changed: 1, breached: 0, resolved: 1 });
    expect(recordActivity).toHaveBeenCalledWith({}, db, expect.objectContaining({ verb: 'trigger.rearmed' }));
  });

  /** An unevaluable trigger is counted and NOT reported healthy — the silence this
   *  whole object exists to break. */
  it('counts an unbound trigger rather than treating it as armed', async () => {
    const db = fakeDb([session], [contract(undefined), trigger({ state: 'armed' })]);
    const result = await runTriggerSweep({} as never, db as never);
    expect(result).toMatchObject({ evaluated: 1, unbound: 1, changed: 1, breached: 0 });
  });

  it('still evaluates a numeric trigger against a liveMetric', async () => {
    const metric = { id: 'm1', sessionId: 's1', kind: 'liveMetric', content: { title: 'Runway', value: '4.5 months' } };
    const numeric = trigger({ id: 't2', title: 'Runway watch', watches: 'Runway', comparator: 'below', threshold: 6, state: 'armed' });
    const db = fakeDb([session], [metric, numeric]);
    const result = await runTriggerSweep({} as never, db as never);
    expect(result).toMatchObject({ evaluated: 1, changed: 1, breached: 1 });
  });
});

describe('describeTransition', () => {
  const base = (over: Partial<ResolvedTrigger>): ResolvedTrigger => ({
    triggerId: 't', triggerTitle: 'T', watchedId: 'w', watchedTitle: 'Acme MSA', watchedKind: 'contract',
    deadlineField: 'renewsAt', deadlineDetail: null, comparator: 'due-within', threshold: 30, thenDo: [],
    evaluation: { state: 'breached', observed: 12, reason: 'breached' },
    ...over,
  });

  /** The figure has to be in the reader's units, or the notification sends them to the
   *  board to find out what it meant — the round trip the sweep exists to remove. */
  it('says days for a deadline, in the direction a person reads', () => {
    expect(describeTransition(base({}), true)).toContain('due in 12 days');
    expect(describeTransition(base({ evaluation: { state: 'breached', observed: 0, reason: 'breached' } }), true)).toContain('due today');
    expect(describeTransition(base({ evaluation: { state: 'breached', observed: -9, reason: 'breached' } }), true)).toContain('9 days overdue');
    expect(describeTransition(base({ evaluation: { state: 'breached', observed: -1, reason: 'breached' } }), true)).toContain('1 day overdue');
  });

  /**
   * FO-G2. A contract has more than one clock, so the field name is not enough: a digest
   * saying "Acme MSA is due in 3 days (nextObligationAt)" is a line somebody has to open
   * the board to understand, which is the round trip the sweep exists to remove.
   */
  it('names the obligation behind a computed deadline instead of the field', () => {
    const line = describeTransition(base({
      deadlineField: 'nextObligationAt',
      deadlineDetail: 'obligation "Quarterly support fee" (SUPPORT-Q)',
      evaluation: { state: 'breached', observed: 3, reason: 'breached' },
    }), true);
    expect(line).toContain('due in 3 days');
    expect(line).toContain('Quarterly support fee');
    expect(line).not.toContain('nextObligationAt');
  });

  it('says the value and the threshold for a numeric trigger', () => {
    const numeric = base({ deadlineField: null, comparator: 'below', threshold: 6, evaluation: { state: 'breached', observed: 4.5, reason: 'breached' } });
    expect(describeTransition(numeric, true)).toContain('4.5');
    expect(describeTransition(numeric, true)).toContain('below');
  });
});
