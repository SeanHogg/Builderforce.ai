import { describe, expect, it } from 'vitest';
import { buildScenario, type ScenarioBaseline } from './deliveryScenario';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 27, 12, 0, 0);

// 10 open tasks, 2 contributors delivering 4/wk → 2/dev/wk baseline.
const base = (over: Partial<ScenarioBaseline> = {}): ScenarioBaseline => ({
  openTasks: 10, throughputPerWeek: 4, activeContributors: 2, targetDate: null, now: NOW, ...over,
});

describe('buildScenario', () => {
  it('holds the baseline pace at the current team + full attention', () => {
    const r = buildScenario(base(), { developers: 2, attentionPct: 100, scopeDelta: 0 });
    expect(r.projectedThroughputPerWeek).toBeCloseTo(4);
    expect(r.projectedWeeks).toBeCloseTo(2.5);
    expect(new Date(r.projectedDate!).getTime()).toBeCloseTo(NOW + 2.5 * 7 * DAY, -6);
  });

  it('halves the timeline when developers double', () => {
    const slow = buildScenario(base(), { developers: 2, attentionPct: 100, scopeDelta: 0 });
    const fast = buildScenario(base(), { developers: 4, attentionPct: 100, scopeDelta: 0 });
    expect(fast.projectedThroughputPerWeek).toBeCloseTo(8);
    expect(fast.projectedWeeks!).toBeCloseTo(slow.projectedWeeks! / 2);
  });

  it('scales pace down with reduced attention', () => {
    const r = buildScenario(base(), { developers: 2, attentionPct: 50, scopeDelta: 0 });
    expect(r.projectedThroughputPerWeek).toBeCloseTo(2);
    expect(r.projectedWeeks).toBeCloseTo(5);
  });

  it('applies a scope cut to the remaining work', () => {
    const r = buildScenario(base(), { developers: 2, attentionPct: 100, scopeDelta: -4 });
    expect(r.adjustedOpenTasks).toBe(6);
    expect(r.projectedWeeks).toBeCloseTo(1.5);
  });

  it('never drives remaining below zero', () => {
    const r = buildScenario(base({ openTasks: 3 }), { developers: 2, attentionPct: 100, scopeDelta: -10 });
    expect(r.adjustedOpenTasks).toBe(0);
    expect(r.status).toBe('done');
    expect(r.projectedWeeks).toBe(0);
  });

  it('grades on_track vs late against the target date', () => {
    const onTrack = buildScenario(base({ targetDate: new Date(NOW + 60 * DAY).toISOString().slice(0, 10) }), { developers: 4, attentionPct: 100, scopeDelta: 0 });
    expect(onTrack.status).toBe('on_track');
    expect(onTrack.deltaDaysVsTarget!).toBeLessThan(0); // finishes early
    const late = buildScenario(base({ targetDate: new Date(NOW + 3 * DAY).toISOString().slice(0, 10) }), { developers: 1, attentionPct: 50, scopeDelta: 0 });
    expect(late.status).toBe('late');
    expect(late.deltaDaysVsTarget!).toBeGreaterThan(0);
  });

  it('reports no_signal when there is no pace to project from', () => {
    expect(buildScenario(base({ throughputPerWeek: 0 }), { developers: 2, attentionPct: 100, scopeDelta: 0 }).status).toBe('no_signal');
    expect(buildScenario(base(), { developers: 0, attentionPct: 100, scopeDelta: 0 }).status).toBe('no_signal');
    expect(buildScenario(base(), { developers: 2, attentionPct: 0, scopeDelta: 0 }).status).toBe('no_signal');
  });

  it('computes effort in person-weeks', () => {
    const r = buildScenario(base(), { developers: 2, attentionPct: 100, scopeDelta: 0 });
    // 2 devs × 2.5 weeks × 1.0 attention = 5 person-weeks
    expect(r.effortPersonWeeks).toBeCloseTo(5);
  });
});
