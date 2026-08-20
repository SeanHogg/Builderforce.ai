import { describe, expect, it } from 'vitest';
import {
  DEADLINE_FIELD_NAMES,
  dateValue,
  daysUntil,
  evaluateCanvasTriggers,
  evaluateTrigger,
  numericValue,
  resolveDeadlineField,
  triggerUnboundHint,
} from './canvasTriggers';
import { allSpecObjectSpecs, deadlineBearingKinds, specDeadlineFields } from './specObjects';
// Registers the vocabularies whose deadline flags the drift guard reads. Importing for
// side effect is how every other spec test reaches the registry.
import './founderObjects';
import './peopleObjects';
import './hiringObjects';
import './academicObjects';
// `nextActionAt` is declared by exactly one kind — `legalMatter` — so the drift guard
// below cannot see it unless this vocabulary has registered. A name in
// `DEADLINE_FIELD_NAMES` that no loaded spec flags is indistinguishable from a name no
// spec flags at all, which is the failure the guard exists to catch.
import './legalObjects';

describe('numericValue', () => {
  it('reads a plain number', () => {
    expect(numericValue(14)).toBe(14);
    expect(numericValue(-3.5)).toBe(-3.5);
  });

  it('reads a formatted string', () => {
    expect(numericValue('14 months')).toBe(14);
    expect(numericValue('1200.50')).toBe(1200.5);
  });

  /**
   * A thousands separator is NOT a decimal point. Read as one, "$1,200" becomes 1.2 and
   * a $1,200 burn compared against a $1,000 ceiling reports healthy by a factor of a
   * thousand — the single most dangerous way this function can be wrong.
   */
  it('distinguishes a thousands separator from a decimal comma', () => {
    expect(numericValue('$1,200')).toBe(1200);
    expect(numericValue('1,200,000')).toBe(1_200_000);
    expect(numericValue('1,200,000.50')).toBe(1_200_000.5);
    expect(numericValue('1200,50')).toBe(1200.5);
  });

  /**
   * THE BUG THIS PAIR PINS. "months" starts with an 'm', and a suffix check that
   * accepted any word beginning with one turned a 14-month runway into 14,000,000 —
   * so a "runway below 6 months" trigger compared 4.5 million against 6 and stayed
   * silent. A trigger that cannot fire is worse than no trigger.
   */
  it('does not read a unit word as a magnitude suffix', () => {
    expect(numericValue('14 months')).toBe(14);
    expect(numericValue('4.5 months')).toBe(4.5);
    expect(numericValue('30 minutes')).toBe(30);
    expect(numericValue('12 basis points')).toBe(12);
  });

  it('accepts bare and written magnitudes', () => {
    expect(numericValue('1.2M')).toBe(1_200_000);
    expect(numericValue('1.2 million')).toBe(1_200_000);
    expect(numericValue('450k')).toBe(450_000);
    expect(numericValue('2 bn')).toBe(2_000_000_000);
  });

  /**
   * A suffix MULTIPLIES. Without this, "$1.2M" parses as 1.2 and a threshold of
   * 1_000_000 reports healthy burn on a company that is on fire.
   */
  it('applies magnitude suffixes', () => {
    expect(numericValue('1.2M')).toBe(1_200_000);
    expect(numericValue('$450K')).toBe(450_000);
    expect(numericValue('2.5B')).toBe(2_500_000_000);
  });

  it('returns null for anything unparseable, rather than NaN', () => {
    expect(numericValue('not disclosed')).toBeNull();
    expect(numericValue('')).toBeNull();
    expect(numericValue(null)).toBeNull();
    expect(numericValue(undefined)).toBeNull();
    expect(numericValue(Number.NaN)).toBeNull();
  });
});

describe('evaluateTrigger', () => {
  const bound = { metricFound: true, metricValue: 5, threshold: 6 };

  it('breaches when a value falls below its threshold', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'below' })).toMatchObject({ state: 'breached', observed: 5, reason: 'breached' });
  });

  it('stays armed when the value is within the threshold', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'above' })).toMatchObject({ state: 'armed', reason: 'within-threshold' });
  });

  it('handles above and equals', () => {
    expect(evaluateTrigger({ metricFound: true, metricValue: 12, threshold: 10, comparator: 'above' }).state).toBe('breached');
    expect(evaluateTrigger({ metricFound: true, metricValue: 10, threshold: 10, comparator: 'equals' }).state).toBe('breached');
    expect(evaluateTrigger({ metricFound: true, metricValue: 11, threshold: 10, comparator: 'equals' }).state).toBe('armed');
  });

  it('defaults an unknown comparator to below rather than silently passing', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'sideways' }).state).toBe('breached');
  });

  describe('changes-by', () => {
    it('breaches on a move at or beyond the threshold, in either direction', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 10, previousValue: 7, threshold: 3, comparator: 'changes-by' }).state).toBe('breached');
      expect(evaluateTrigger({ metricFound: true, metricValue: 4, previousValue: 7, threshold: 3, comparator: 'changes-by' }).state).toBe('breached');
    });

    it('stays armed on a smaller move', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 8, previousValue: 7, threshold: 3, comparator: 'changes-by' }).state).toBe('armed');
    });

    it('cannot breach without a previous observation, and says so', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 10, threshold: 3, comparator: 'changes-by' }))
        .toMatchObject({ state: 'armed', reason: 'no-previous-value' });
    });
  });

  /**
   * The three unbound states. Each one is reported distinctly because "armed" over an
   * unevaluated threshold is the failure the tool exists to prevent — a founder told
   * "all clear" about a number nothing actually checked.
   */
  describe('unbound', () => {
    it('reports a missing metric', () => {
      expect(evaluateTrigger({ metricFound: false, threshold: 6, comparator: 'below' }))
        .toMatchObject({ state: 'unbound', reason: 'no-metric', observed: null });
    });

    it('reports a metric that has no value yet', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 'not disclosed', threshold: 6, comparator: 'below' }))
        .toMatchObject({ state: 'unbound', reason: 'metric-has-no-value' });
    });

    it('reports a trigger with no threshold', () => {
      expect(evaluateTrigger({ metricFound: true, metricValue: 5, comparator: 'below' }))
        .toMatchObject({ state: 'unbound', reason: 'no-threshold', observed: 5 });
    });
  });

  it('respects a muted trigger before anything else', () => {
    expect(evaluateTrigger({ ...bound, comparator: 'below', state: 'muted' }))
      .toMatchObject({ state: 'muted', reason: 'muted' });
  });

  it('compares formatted values on the same scale', () => {
    // Runway written "4.5 months" against a threshold of 6.
    expect(evaluateTrigger({ metricFound: true, metricValue: '4.5 months', threshold: '6', comparator: 'below' }).state).toBe('breached');
    // Burn written "$1.2M" against a $1M ceiling — the suffix case that matters.
    expect(evaluateTrigger({ metricFound: true, metricValue: '$1.2M', threshold: '1000000', comparator: 'above' }).state).toBe('breached');
  });
});

// ---------------------------------------------------------------------------
// Dates — the half that did not exist
// ---------------------------------------------------------------------------

/** A fixed "now" so every case sits on a known day rather than on the clock. */
const NOW = Date.parse('2026-08-15T12:00:00Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('dateValue', () => {
  it('reads ISO dates and instants', () => {
    expect(dateValue('2026-09-30')).toBe(Date.parse('2026-09-30'));
    expect(dateValue('2026-09-30T17:00:00Z')).toBe(Date.parse('2026-09-30T17:00:00Z'));
    expect(dateValue(new Date('2026-09-30'))).toBe(Date.parse('2026-09-30'));
  });

  /**
   * THE TRAP THIS PINS. `Date.parse('30')` is a valid date in some engines, so a
   * threshold ("30" days) pasted into a deadline field would silently become a date in
   * the year 2030 and the trigger would report a renewal four years out. A value with no
   * date punctuation is refused rather than guessed at.
   */
  it('refuses a bare number rather than reading it as a year', () => {
    expect(dateValue('30')).toBeNull();
    expect(dateValue('2026')).toBeNull();
    expect(dateValue(30)).toBeNull();
  });

  it('returns null for anything unparseable', () => {
    expect(dateValue('not disclosed')).toBeNull();
    expect(dateValue('next quarter')).toBeNull();
    expect(dateValue('')).toBeNull();
    expect(dateValue(null)).toBeNull();
  });
});

describe('daysUntil', () => {
  it('counts today as 0 and yesterday as -1', () => {
    expect(daysUntil(NOW, NOW)).toBe(0);
    expect(daysUntil(NOW + 86_400_000, NOW)).toBe(1);
    expect(daysUntil(NOW - 86_400_000, NOW)).toBe(-1);
  });
});

describe('resolveDeadlineField', () => {
  it('honours an explicitly named field', () => {
    expect(resolveDeadlineField({ dueAt: '2026-09-30', renewsAt: '2026-12-01' }, 'renewsAt')).toBe('renewsAt');
  });

  it('falls back to the first declared name actually present', () => {
    expect(resolveDeadlineField({ renewsAt: '2026-12-01' })).toBe('renewsAt');
    expect(resolveDeadlineField({ dueAt: '2026-09-30', renewsAt: '2026-12-01' })).toBe('dueAt');
  });

  /** A half-filled card is the normal case: an empty `dueAt` must not shadow a filled
   *  `renewsAt`, or a contract with a renewal reports "no deadline". */
  it('skips an empty field rather than resolving to it', () => {
    expect(resolveDeadlineField({ dueAt: '   ', renewsAt: '2026-12-01' })).toBe('renewsAt');
    expect(resolveDeadlineField({ dueAt: '', renewsAt: '' })).toBeNull();
  });

  it('returns null when the object carries no deadline at all', () => {
    expect(resolveDeadlineField({ title: 'A competitor' })).toBeNull();
  });
});

describe('evaluateTrigger — deadlines', () => {
  const due = (deadlineValue: string, comparator: string, threshold?: unknown) =>
    evaluateTrigger({ metricFound: true, comparator, threshold, deadlineValue, nowMs: NOW });

  describe('due-within', () => {
    it('breaches inside the window and stays armed outside it', () => {
      expect(due(inDays(12), 'due-within', 30)).toMatchObject({ state: 'breached', observed: 12 });
      expect(due(inDays(45), 'due-within', 30)).toMatchObject({ state: 'armed', observed: 45, reason: 'within-threshold' });
    });

    it('breaches exactly on the boundary', () => {
      expect(due(inDays(30), 'due-within', 30).state).toBe('breached');
    });

    /**
     * THE RULE THE WHOLE OBJECT EXISTS FOR. A renewal that slipped past unnoticed must
     * STAY breached. An exclusive window would have re-armed it the day after it lapsed,
     * so the one board that needed to shout would go quiet — the auto-renewal nobody
     * caught, produced by the alarm meant to catch it.
     */
    it('stays breached once the date has passed', () => {
      expect(due(inDays(-1), 'due-within', 30)).toMatchObject({ state: 'breached', observed: -1 });
      expect(due(inDays(-400), 'due-within', 30).state).toBe('breached');
    });

    /** A forgotten threshold reads as "the day it passes" rather than falling silent —
     *  the one asymmetry with the numeric path, argued in `evaluateDeadline`. */
    it('treats a missing threshold as same-day rather than unbound', () => {
      expect(due(inDays(5), 'due-within')).toMatchObject({ state: 'armed', observed: 5 });
      expect(due(inDays(0), 'due-within').state).toBe('breached');
    });
  });

  describe('overdue-by', () => {
    it('does not breach before the date', () => {
      expect(due(inDays(5), 'overdue-by', 7)).toMatchObject({ state: 'armed', observed: 5 });
    });

    it('breaches only once it is late by the threshold', () => {
      expect(due(inDays(-3), 'overdue-by', 7)).toMatchObject({ state: 'armed', observed: -3 });
      expect(due(inDays(-7), 'overdue-by', 7)).toMatchObject({ state: 'breached', observed: -7 });
      expect(due(inDays(-30), 'overdue-by', 7).state).toBe('breached');
    });

    /** `0` means the day AFTER it lapses: something due today is not yet overdue. */
    it('with a zero threshold fires the day after, not on the day', () => {
      expect(due(inDays(0), 'overdue-by', 0).state).toBe('armed');
      expect(due(inDays(-1), 'overdue-by', 0).state).toBe('breached');
    });
  });

  describe('unbound', () => {
    it('reports an object with no deadline set', () => {
      expect(evaluateTrigger({ metricFound: true, comparator: 'due-within', threshold: 30, nowMs: NOW }))
        .toMatchObject({ state: 'unbound', reason: 'no-deadline-field', observed: null });
      expect(evaluateTrigger({ metricFound: true, comparator: 'due-within', threshold: 30, deadlineValue: '  ', nowMs: NOW }).reason)
        .toBe('no-deadline-field');
    });

    it('reports a deadline that is not a date', () => {
      expect(due('next quarter', 'due-within', 30))
        .toMatchObject({ state: 'unbound', reason: 'deadline-not-a-date' });
    });

    it('still respects muted and a missing watched object', () => {
      expect(evaluateTrigger({ metricFound: true, comparator: 'due-within', state: 'muted', nowMs: NOW }).state).toBe('muted');
      expect(evaluateTrigger({ metricFound: false, comparator: 'due-within', nowMs: NOW }).reason).toBe('no-metric');
    });
  });
});

// ---------------------------------------------------------------------------
// Board resolution
// ---------------------------------------------------------------------------

describe('evaluateCanvasTriggers', () => {
  const contract = { id: 'c1', data: { kind: 'contract', title: 'Acme MSA (2026)', renewsAt: inDays(20) } };
  const metric = { id: 'm1', data: { kind: 'liveMetric', title: 'Runway', value: '4.5 months' } };

  it('watches a deadline on a non-metric object', () => {
    const trigger = { id: 't1', data: { kind: 'trigger', title: 'Renewal watch', watches: 'Acme MSA', comparator: 'due-within', threshold: 30 } };
    const [result] = evaluateCanvasTriggers([contract, trigger], NOW);
    expect(result).toMatchObject({
      watchedId: 'c1', watchedKind: 'contract', deadlineField: 'renewsAt',
      evaluation: { state: 'breached', observed: 20 },
    });
  });

  it('still watches a liveMetric numerically', () => {
    const trigger = { id: 't2', data: { kind: 'trigger', title: 'Runway watch', watches: 'Runway', comparator: 'below', threshold: 6 } };
    const [result] = evaluateCanvasTriggers([metric, trigger], NOW);
    expect(result).toMatchObject({ watchedKind: 'liveMetric', deadlineField: null, evaluation: { state: 'breached', observed: 4.5 } });
  });

  /** Without the self-exclusion a trigger titled like its own `watches` value resolves to
   *  itself, reads no deadline, and reports unbound for a reason nobody can see. */
  it('never resolves a trigger to itself', () => {
    const trigger = { id: 't3', data: { kind: 'trigger', title: 'Renewal', watches: 'Renewal', comparator: 'due-within', threshold: 30 } };
    const [result] = evaluateCanvasTriggers([trigger], NOW);
    expect(result.watchedId).toBeNull();
    expect(result.evaluation.reason).toBe('no-metric');
  });

  it('evaluates one trigger when asked, and all of them otherwise', () => {
    const a = { id: 't4', data: { kind: 'trigger', title: 'A', watches: 'Acme MSA', comparator: 'due-within', threshold: 30 } };
    const b = { id: 't5', data: { kind: 'trigger', title: 'B', watches: 'Runway', comparator: 'below', threshold: 6 } };
    expect(evaluateCanvasTriggers([contract, metric, a, b], NOW)).toHaveLength(2);
    expect(evaluateCanvasTriggers([contract, metric, a, b], NOW, { onlyTriggerId: 't4' })).toHaveLength(1);
  });

  it('explains every unbound state in words a person can act on', () => {
    const orphan = { id: 't6', data: { kind: 'trigger', title: 'Orphan', watches: 'Nothing here', comparator: 'due-within' } };
    const undated = { id: 'x1', data: { kind: 'contract', title: 'Undated MSA' } };
    const undatedWatch = { id: 't7', data: { kind: 'trigger', title: 'W', watches: 'Undated MSA', comparator: 'due-within' } };
    const [a] = evaluateCanvasTriggers([orphan], NOW);
    const [b] = evaluateCanvasTriggers([undated, undatedWatch], NOW);
    expect(triggerUnboundHint(a)).toContain('watches');
    // Names the field the WATCHED KIND actually declares, not a generic apology.
    expect(triggerUnboundHint(b)).toContain('renewsAt');
  });
});

// ---------------------------------------------------------------------------
// The drift guard
// ---------------------------------------------------------------------------

/**
 * The declaration (`SpecField.deadline`, per kind, in the frontend registry) and the name
 * list (`DEADLINE_FIELD_NAMES`, in the contract package the SERVER reads) are two places
 * because the sweep cannot import the frontend registry. This is what stops them being
 * two ANSWERS: a field flagged on a spec and absent from the list would be watchable on
 * the board and invisible to the nightly sweep, which is precisely the "reports armed on
 * screen and breached in a digest" failure the shared engine exists to prevent.
 */
describe('deadline declarations', () => {
  it('every flagged spec field is a name the server can resolve', () => {
    const flagged = new Set(allSpecObjectSpecs()
      .flatMap((spec) => spec.fields.filter((field) => field.deadline).map((field) => field.name)));
    expect(flagged.size).toBeGreaterThan(0);
    for (const name of flagged) expect(DEADLINE_FIELD_NAMES).toContain(name);
  });

  it('every name the server can resolve is flagged by some vocabulary', () => {
    const flagged = new Set(allSpecObjectSpecs()
      .flatMap((spec) => spec.fields.filter((field) => field.deadline).map((field) => field.name)));
    for (const name of DEADLINE_FIELD_NAMES) expect([...flagged]).toContain(name);
  });

  it('names the kinds a founder is actually ambushed by', () => {
    const kinds = deadlineBearingKinds();
    for (const kind of ['contract', 'invoice', 'bill', 'fundingRound', 'obligation', 'policy', 'offer']) {
      expect(kinds).toContain(kind);
    }
    expect(specDeadlineFields('contract')).toEqual(['renewsAt']);
    expect(specDeadlineFields('competitor')).toEqual([]);
  });
});
