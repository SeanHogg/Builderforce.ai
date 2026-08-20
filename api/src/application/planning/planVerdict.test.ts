import { describe, expect, it } from 'vitest';
import { scheduleItems } from './scheduleWork';
import {
  emptyPlanVerdict, planFits, planVerdictCounts, planVerdictIsClean, summarizePlanVerdict,
} from './planVerdict';

const MONDAY = new Date('2026-08-03T00:00:00.000Z');

describe('summarizePlanVerdict', () => {
  it('reports a clean plan as clean', () => {
    const verdict = summarizePlanVerdict(scheduleItems([{ key: 'a', estimateDays: 1 }], { anchor: MONDAY }));
    expect(planVerdictIsClean(verdict)).toBe(true);
    expect(verdict).toEqual(emptyPlanVerdict());
  });

  it('carries COMPRESSION out of the schedule — the one fact the rows cannot show', () => {
    // Once estimates are squeezed to fit, the windows fit perfectly and nothing left
    // in the data says they were ever squeezed. This is why the verdict is recorded.
    const plan = scheduleItems(
      [{ key: 'a', estimateDays: 10 }, { key: 'b', estimateDays: 10, afterKeys: ['a'] }],
      { anchor: MONDAY, deadline: new Date('2026-08-14T00:00:00Z') },
    );
    const verdict = summarizePlanVerdict(plan);
    expect(verdict.compressed).toBe(true);
    expect(planFits(verdict)).toBe(false);
  });

  it('reports an overrun it could not compress away', () => {
    const plan = scheduleItems(
      [{ key: 'a', estimateDays: 5 }, { key: 'b', estimateDays: 5, afterKeys: ['a'] }],
      { anchor: MONDAY, deadline: new Date('2026-08-03T00:00:00Z') },
    );
    expect(summarizePlanVerdict(plan).overruns.length).toBeGreaterThan(0);
  });

  it('reports a dependency cycle', () => {
    const plan = scheduleItems(
      [
        { key: 'a', estimateDays: 1, afterKeys: ['b'] },
        { key: 'b', estimateDays: 1, afterKeys: ['a'] },
      ],
      { anchor: MONDAY },
    );
    expect(summarizePlanVerdict(plan).cyclic.sort()).toEqual(['a', 'b']);
  });

  it('re-keys plan indices to real ids, because "child 2" is not actionable', () => {
    const plan = scheduleItems(
      [
        { key: '0', estimateDays: 1, afterKeys: ['1'] },
        { key: '1', estimateDays: 1, afterKeys: ['0'] },
      ],
      { anchor: MONDAY },
    );
    const ids = new Map([['0', '4711'], ['1', '4712']]);
    expect(summarizePlanVerdict(plan, (k) => ids.get(k) ?? null).cyclic.sort()).toEqual(['4711', '4712']);
  });

  it('drops a key that never became a row rather than naming a ghost', () => {
    const plan = scheduleItems(
      [
        { key: '0', estimateDays: 1, afterKeys: ['1'] },
        { key: '1', estimateDays: 1, afterKeys: ['0'] },
      ],
      { anchor: MONDAY },
    );
    expect(summarizePlanVerdict(plan, (k) => (k === '0' ? '4711' : null)).cyclic).toEqual(['4711']);
  });
});

describe('planFits', () => {
  it('does NOT treat capacity deferral as a misfit', () => {
    // The plan still lands inside the window; one person is simply the constraint.
    // Warning about it would train people to ignore the warning that matters.
    const verdict = { ...emptyPlanVerdict(), capacityDeferred: ['4711'] };
    expect(planFits(verdict)).toBe(true);
    expect(planVerdictIsClean(verdict)).toBe(true);
  });

  it('summarises to the counts a badge or a journal entry needs', () => {
    expect(planVerdictCounts({
      compressed: true, overruns: ['1'], cyclic: ['2', '3'], capacityDeferred: ['4'],
    })).toEqual({
      compressed: true, overrunCount: 1, cyclicCount: 2, capacityDeferredCount: 1, fits: false,
    });
  });
});
