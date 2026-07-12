import { describe, expect, it } from 'vitest';
import {
  estimateBacklogBurnRate,
  timeUnitToHours,
  normaliseToHours,
  velocitySeriesPerHour,
  type EstimateInput,
  type BacklogInput,
  type VelocityInput,
  type CalendarContext,
} from './backlogBurnRate';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Current time anchor for reproducible tests. */
const NOW = Date.UTC(2026, 5, 27, 12, 0, 0);

const DAY_MS = 86_400_000;

function makeInput(over: Partial<EstimateInput> = {}): EstimateInput {
  return {
    velocity: { singleValue: { units: 12, timeUnit: 'week' } },
    backlog: { totalRemaining: 120, unit: 'story_points' },
    now: NOW,
    ...over,
  };
}

function withCalendar(input: EstimateInput, over: Partial<CalendarContext> = {}): EstimateInput {
  return {
    ...input,
    calendar: {
      workingHoursPerDay: 8,
      agentUptimeHoursPerDay: 24,
      daysPerWeek: 5,
      ...over,
    },
  };
}

// ---------------------------------------------------------------------------
// Unit-level helper tests
// ---------------------------------------------------------------------------

describe('timeUnitToHours', () => {
  it('returns 1 for hour', () => expect(timeUnitToHours('hour')).toBe(1));
  it('returns 8 for day', () => expect(timeUnitToHours('day')).toBe(8));
  it('returns 40 for week', () => expect(timeUnitToHours('week')).toBe(40));
  it('returns 160 for sprint', () => expect(timeUnitToHours('sprint')).toBe(160));
});

describe('normaliseToHours', () => {
  it('converts 5 days to 40 hours', () => {
    expect(normaliseToHours(5, 'day')).toBe(40);
  });
  it('converts 2 sprints to 320 hours', () => {
    expect(normaliseToHours(2, 'sprint')).toBe(320);
  });
});

describe('velocitySeriesPerHour', () => {
  it('converts each entry to units/hour', () => {
    const series = [
      { units: 40, timeUnit: 'week' as const, track: 'agent' as const },
      { units: 12, timeUnit: 'day' as const, track: 'agent' as const },
      { units: 2, timeUnit: 'hour' as const, track: 'agent' as const },
    ];
    // 40/40 = 1, 12/8 = 1.5, 2/1 = 2
    expect(velocitySeriesPerHour(series)).toEqual([1, 1.5, 2]);
  });

  it('returns empty array for empty input', () => {
    expect(velocitySeriesPerHour([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-1: Single velocity + pre-aggregated backlog → expected hours within 2s
// ---------------------------------------------------------------------------

describe('AC-1 — single velocity + pre-aggregated backlog', () => {
  it('computes expected hours from a single velocity value', () => {
    // 12 story points / week → 12/40 = 0.3 units/hour
    // 120 / 0.3 = 400 hours expected
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.expectedHours).toBeCloseTo(400, 0);
    expect(result.velocitySource).toBe('single');
    expect(result.velocityPeriods).toBe(1);
    expect(result.expectedHours).toBeGreaterThan(0);
    expect(result.expectedHours).toBeLessThan(Infinity);
  });

  it('returns within reasonable bounds (sanity: no pathological values)', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.pessimisticHours).toBeGreaterThan(result.expectedHours);
    expect(result.optimisticHours).toBeLessThan(result.expectedHours);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Velocity time-series ≥ 3 periods → pessimistic/expected/optimistic
// ---------------------------------------------------------------------------

describe('AC-2 — time-series ≥ 3 periods with confidence bounds', () => {
  const timeSeries: VelocityInput = {
    timeSeries: [
      { units: 10, timeUnit: 'week', track: 'agent' },
      { units: 14, timeUnit: 'week', track: 'agent' },
      { units: 12, timeUnit: 'week', track: 'agent' },
      { units: 11, timeUnit: 'week', track: 'agent' },
      { units: 13, timeUnit: 'week', track: 'agent' },
    ],
  };

  it('computes distinct pessimistic/expected/optimistic hours', () => {
    const result = estimateBacklogBurnRate(makeInput({ velocity: timeSeries }));
    // mean = (10+14+12+11+13)/5 = 12, σ ~ 1.58
    expect(result.velocitySource).toBe('time_series');
    expect(result.velocityPeriods).toBe(5);
    expect(result.velocityUnitsPerHour).toBeGreaterThan(0);
    // pessimistic < expected (higher velocity = fewer hours, so pessimistic = more hours)
    expect(result.pessimisticHours).toBeGreaterThan(result.expectedHours);
    expect(result.optimisticHours).toBeLessThan(result.expectedHours);
  });

  it('labels confidence High when ≥ 3 periods and low WIP', () => {
    const result = estimateBacklogBurnRate(makeInput({ velocity: timeSeries }));
    expect(result.confidence).toBe('High');
  });
});

// ---------------------------------------------------------------------------
// AC-3: Dual-track (agent + human) → separate hours that sum to total
// ---------------------------------------------------------------------------

describe('AC-3 — dual-track agent + human velocities', () => {
  it('reports separate agent and human estimated hours', () => {
    const input = makeInput({
      velocity: {
        agent: { units: 8, timeUnit: 'day' },   // 8/8 = 1 unit/hour
        human: { units: 4, timeUnit: 'day' },    // 4/8 = 0.5 units/hour
      },
    });
    const result = estimateBacklogBurnRate(input);
    expect(result.velocitySource).toBe('dual_track');
    expect(result.agentVelocity).toBeCloseTo(1, 2);
    expect(result.humanVelocity).toBeCloseTo(0.5, 2);
    // Combined rate = 1.5 units/hour → 120/1.5 = 80 hours
    expect(result.expectedHours).toBeCloseTo(80, 0);
    // Both tracks get the same estimated hours (total effort / total rate)
    expect(result.agentEstimatedHours).toBeCloseTo(80, 0);
    expect(result.humanEstimatedHours).toBeCloseTo(80, 0);
  });

  it('includes a workforce breakdown in the markdown', () => {
    const input = makeInput({
      velocity: {
        agent: { units: 8, timeUnit: 'day' },
        human: { units: 4, timeUnit: 'day' },
      },
    });
    const result = estimateBacklogBurnRate(input);
    expect(result.markdownSummary).toContain('AI Agent');
    expect(result.markdownSummary).toContain('Human');
  });
});

// ---------------------------------------------------------------------------
// AC-4: Target deadline → break-even velocity + sufficient flag
// ---------------------------------------------------------------------------

describe('AC-4 — target deadline produces break-even velocity', () => {
  it('outputs break-even velocity and sufficiency flag', () => {
    // 120 story points, velocity = 12/week = 0.3 units/hour
    // Target: 10 days from now = 10*8 = 80 working hours
    // Break-even = 120/80 = 1.5 units/hour
    const targetDate = new Date(NOW + 10 * DAY_MS).toISOString().slice(0, 10);
    const input = withCalendar(makeInput({ targetDate }));
    const result = estimateBacklogBurnRate(input);
    expect(result.breakEvenVelocity).toBeCloseTo(1.5, 1);
    expect(result.currentVelocitySufficient).toBe(false); // 0.3 < 1.5
  });

  it('flags sufficient when velocity exceeds break-even', () => {
    // High velocity: 120 points / day = 15 units/hour
    // Target: 10 days → 80 working hours → break-even 1.5 units/hour
    const targetDate = new Date(NOW + 10 * DAY_MS).toISOString().slice(0, 10);
    const input = withCalendar(makeInput({
      velocity: { singleValue: { units: 120, timeUnit: 'day' } },
      targetDate,
    }));
    const result = estimateBacklogBurnRate(input);
    expect(result.currentVelocitySufficient).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-5: JSON output validates against schema (all required fields present)
// ---------------------------------------------------------------------------

describe('AC-5 — JSON output schema completeness', () => {
  const result = estimateBacklogBurnRate(makeInput());

  it('has all required top-level fields', () => {
    expect(result).toHaveProperty('requestedAt');
    expect(result).toHaveProperty('backlogSize');
    expect(result).toHaveProperty('blockedHoursAtRisk');
    expect(result).toHaveProperty('flaggedInsights');
    expect(result).toHaveProperty('velocitySource');
    expect(result).toHaveProperty('velocityPeriods');
    expect(result).toHaveProperty('velocityUnitsPerHour');
    expect(result).toHaveProperty('velocityTimeUnit');
    expect(result).toHaveProperty('agentVelocity');
    expect(result).toHaveProperty('agentEstimatedHours');
    expect(result).toHaveProperty('humanVelocity');
    expect(result).toHaveProperty('humanEstimatedHours');
    expect(result).toHaveProperty('pessimisticHours');
    expect(result).toHaveProperty('expectedHours');
    expect(result).toHaveProperty('optimisticHours');
    expect(result).toHaveProperty('estimatedCompletionDate');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('assumptions');
    expect(result).toHaveProperty('sensitivity');
    expect(result).toHaveProperty('breakEvenVelocity');
    expect(result).toHaveProperty('currentVelocitySufficient');
    expect(result).toHaveProperty('inProgressEffortPct');
    expect(result).toHaveProperty('inProgressWarning');
    expect(result).toHaveProperty('markdownSummary');
  });

  it('has no null required numeric fields', () => {
    expect(result.expectedHours).toBeTypeOf('number');
    expect(result.pessimisticHours).toBeTypeOf('number');
    expect(result.optimisticHours).toBeTypeOf('number');
    expect(result.backlogSize).toBeTypeOf('number');
    expect(result.velocityPeriods).toBeTypeOf('number');
    expect(result.velocityUnitsPerHour).toBeTypeOf('number');
  });

  it('has a non-empty markdown summary', () => {
    expect(result.markdownSummary.length).toBeGreaterThan(0);
  });

  it('has sensitivity as an array', () => {
    expect(Array.isArray(result.sensitivity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Fewer than 3 velocity periods → Low confidence + assumption warning
// ---------------------------------------------------------------------------

describe('AC-6 — low confidence with < 3 periods', () => {
  it('labels confidence Low when no velocity data', () => {
    const result = estimateBacklogBurnRate(makeInput({
      velocity: { singleValue: null, timeSeries: null },
    }));
    expect(result.confidence).toBe('Low');
  });

  it('labels confidence Low with 1 period (AC-6: < 3 periods → Low)', () => {
    const result = estimateBacklogBurnRate(makeInput());
    // Single value = 1 period → fewer than 3 → Low confidence
    expect(result.confidence).toBe('Low');
  });

  it('labels confidence Low with a 2-period time-series', () => {
    const result = estimateBacklogBurnRate(makeInput({
      velocity: {
        timeSeries: [
          { units: 12, timeUnit: 'week', track: 'agent' },
          { units: 14, timeUnit: 'week', track: 'agent' },
        ],
      },
    }));
    expect(result.confidence).toBe('Low');
    expect(result.flaggedInsights.some((i) => i.label === 'Low Confidence')).toBe(true);
  });

  it('includes a warning insight about low data', () => {
    const result = estimateBacklogBurnRate(makeInput());
    const hasLowConfidenceInsight = result.flaggedInsights.some(
      (i) => i.label === 'Low Confidence'
    );
    expect(hasLowConfidenceInsight).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Blocked items excluded from estimate, reported in blocked_hours_at_risk
// ---------------------------------------------------------------------------

describe('AC-7 — blocked items excluded with blocked_hours_at_risk', () => {
  it('excludes blocked items from main estimate', () => {
    const input = makeInput({
      backlog: {
        items: [
          { effort: 50, status: 'remaining' },
          { effort: 30, status: 'blocked' },
          { effort: 20, status: 'in_progress' },
        ],
        unit: 'story_points',
      },
      velocity: { singleValue: { units: 10, timeUnit: 'day' } },
      now: NOW,
    });
    const result = estimateBacklogBurnRate(input);
    // 50 + 20 = 70 remaining (blocked excluded)
    expect(result.backlogSize).toBe(70);
    // blocked effort = 30
    // velocity = 10/8 = 1.25 units/hour → 30/1.25 = 24 hours at risk
    expect(result.blockedHoursAtRisk).toBeCloseTo(24, 0);
    expect(result.flaggedInsights.some((i) => i.label === 'Blocked Items')).toBe(true);
  });

  it('handles pre-aggregated blocked totals', () => {
    const input = makeInput({
      backlog: {
        totalRemaining: 100,
        totalBlocked: 40,
        unit: 'story_points',
      },
    });
    const result = estimateBacklogBurnRate(input);
    expect(result.blockedHoursAtRisk).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-8: Sensitivity table reflects all four scenarios
// ---------------------------------------------------------------------------

describe('AC-8 — sensitivity table for ±10 %, ±25 %', () => {
  it('contains exactly 4 rows', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.sensitivity).toHaveLength(4);
  });

  it('has the correct scenario labels', () => {
    const result = estimateBacklogBurnRate(makeInput());
    const labels = result.sensitivity.map((r) => r.label);
    expect(labels).toContain('-25 %');
    expect(labels).toContain('-10 %');
    expect(labels).toContain('+10 %');
    expect(labels).toContain('+25 %');
  });

  it('computes inverse relationship: lower velocity → more hours', () => {
    const result = estimateBacklogBurnRate(makeInput());
    const minus25 = result.sensitivity.find((r) => r.label === '-25 %')!;
    const plus25 = result.sensitivity.find((r) => r.label === '+25 %')!;
    expect(minus25.estimatedHours).toBeGreaterThan(plus25.estimatedHours);
  });

  it('includes a completion date when calendar context is provided', () => {
    const input = withCalendar(makeInput());
    const result = estimateBacklogBurnRate(input);
    for (const row of result.sensitivity) {
      expect(row.estimatedDate).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// FR-3: Calendar estimate
// ---------------------------------------------------------------------------

describe('FR-3 — calendar estimate with working hours context', () => {
  it('produces a completion date when calendar context is given', () => {
    const input = withCalendar(makeInput());
    const result = estimateBacklogBurnRate(input);
    expect(result.estimatedCompletionDate).toBeTruthy();
    expect(result.estimatedCompletionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns null completion date when no calendar context', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.estimatedCompletionDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FR-5: Break-even + sensitivity
// ---------------------------------------------------------------------------

describe('FR-5 — sensitivity analysis details', () => {
  it('includes break-even velocity in the markdown when target is set', () => {
    const targetDate = new Date(NOW + 30 * DAY_MS).toISOString().slice(0, 10);
    const input = withCalendar(makeInput({ targetDate }));
    const result = estimateBacklogBurnRate(input);
    expect(result.markdownSummary).toContain('Break-even');
    expect(result.markdownSummary).toContain('sufficient');
  });

  it('does not report break-even without a target date', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.breakEvenVelocity).toBeNull();
    expect(result.currentVelocitySufficient).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FR-6: Blocking & risk flags
// ---------------------------------------------------------------------------

describe('FR-6 — blocking and risk flags', () => {
  it('flags in-progress warning > 30 %', () => {
    const input = makeInput({
      backlog: {
        items: [
          { effort: 50, status: 'remaining' },
          { effort: 40, status: 'in_progress' },
          { effort: 10, status: 'remaining' },
        ],
        unit: 'hours',
      },
    });
    const result = estimateBacklogBurnRate(input);
    // in-progress = 40, total = 100 → 40 %
    expect(result.inProgressEffortPct).toBeCloseTo(40, 0);
    expect(result.inProgressWarning).toBe(true);
  });

  it('does not flag in-progress warning when ≤ 30 %', () => {
    const input = makeInput({
      backlog: {
        items: [
          { effort: 80, status: 'remaining' },
          { effort: 20, status: 'in_progress' },
        ],
        unit: 'hours',
      },
    });
    const result = estimateBacklogBurnRate(input);
    // in-progress = 20, total = 100 → 20 %
    expect(result.inProgressWarning).toBe(false);
  });

  it('warns when velocity data covers fewer than 3 periods', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.flaggedInsights.some((i) => i.label === 'Low Confidence')).toBe(true);
  });

  it('reports blocked items as a warning insight', () => {
    const input = makeInput({
      backlog: {
        items: [
          { effort: 50, status: 'remaining' },
          { effort: 30, status: 'blocked' },
        ],
        unit: 'story_points',
      },
    });
    const result = estimateBacklogBurnRate(input);
    expect(result.flaggedInsights.some((i) => i.label === 'Blocked Items')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('returns Infinity hours when velocity is zero', () => {
    const result = estimateBacklogBurnRate(makeInput({
      velocity: { singleValue: { units: 0, timeUnit: 'week' } },
    }));
    expect(result.expectedHours).toBe(Infinity);
    expect(result.markdownSummary).toContain('Cannot compute estimate');
  });

  it('handles an empty backlog gracefully', () => {
    const result = estimateBacklogBurnRate(makeInput({
      backlog: { items: [], unit: 'tasks' },
    }));
    expect(result.backlogSize).toBe(0);
    expect(result.expectedHours).toBe(0);
  });

  it('handles a backlog of zero remaining', () => {
    const result = estimateBacklogBurnRate(makeInput({
      backlog: { totalRemaining: 0, unit: 'story_points' },
    }));
    expect(result.expectedHours).toBe(0);
  });

  it('handles tasks unit (FR-1 supports tasks)', () => {
    const result = estimateBacklogBurnRate(makeInput({
      backlog: { totalRemaining: 50, unit: 'tasks' },
      velocity: { singleValue: { units: 5, timeUnit: 'day' } },
    }));
    // 5/8 = 0.625 tasks/hour → 50/0.625 = 80 hours
    expect(result.expectedHours).toBeCloseTo(80, 0);
  });

  it('handles sprint time unit', () => {
    const result = estimateBacklogBurnRate(makeInput({
      velocity: { singleValue: { units: 30, timeUnit: 'sprint' } },
    }));
    // 30/160 = 0.1875 units/hour → 120/0.1875 = 640 hours
    expect(result.expectedHours).toBeCloseTo(640, 0);
  });

  it('includes all assumptions in the output', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.assumptions.length).toBeGreaterThanOrEqual(1);
  });

  it('markdown summary contains the backlog size', () => {
    const result = estimateBacklogBurnRate(makeInput());
    expect(result.markdownSummary).toContain('120');
    expect(result.markdownSummary).toContain('story points');
  });

  it('produces deterministic output for the same input', () => {
    const a = estimateBacklogBurnRate(makeInput());
    const b = estimateBacklogBurnRate(makeInput());
    expect(a.expectedHours).toBe(b.expectedHours);
    expect(a.pessimisticHours).toBe(b.pessimisticHours);
    expect(a.optimisticHours).toBe(b.optimisticHours);
  });
});