import { describe, it, expect } from 'vitest';
import { computeDeliveryVerdict } from './DeliveryVerdict';
import type { DoraInsights, BottleneckInsights, LifecycleInsights } from '@/lib/builderforceApi';

/** Minimal fixtures — only the fields the verdict reads. */
const dora = (o: Partial<DoraInsights> = {}): DoraInsights => ({
  windowDays: 30, deploymentFrequencyPerDay: 0, totalDeployments: 0,
  leadTimeHours: null, changeFailureRatePct: null, mttrHours: null, series: [], ...o,
});
const life = (o: Partial<LifecycleInsights> = {}): LifecycleInsights =>
  ({ windowDays: 30, sampleSize: 0, totalAvgHours: 0, byPhase: [], trend: [], ...o });
const bott = (o: Partial<BottleneckInsights> = {}): BottleneckInsights => ({
  windowDays: 30,
  sampleSize: 0,
  byStage: [],
  slowestStage: null,
  rework: { reworkedTasks: 0, totalReopens: 0, totalRedos: 0, reworkRate: 0 },
  agingWip: { stuckCount: 0, thresholdHours: 72, oldest: [] },
  ...o,
});

describe('computeDeliveryVerdict', () => {
  it('returns no_data when there is neither throughput nor deployments', () => {
    const r = computeDeliveryVerdict(dora(), life(), bott());
    expect(r.verdict).toBe('no_data');
    expect(r.score).toBeNull();
    expect(r.reasons).toHaveLength(0);
  });

  it('scores an elite team as delivering value', () => {
    const r = computeDeliveryVerdict(
      dora({ deploymentFrequencyPerDay: 3, totalDeployments: 90, leadTimeHours: 6, changeFailureRatePct: 2, mttrHours: 0.5 }),
      life({ totalAvgHours: 48, sampleSize: 40 }),
      bott(),
    );
    expect(r.verdict).toBe('yes');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('flags a stalling team and surfaces the stuck-WIP reason', () => {
    const r = computeDeliveryVerdict(
      dora({ deploymentFrequencyPerDay: 0.01, totalDeployments: 1, leadTimeHours: 900, changeFailureRatePct: 45, mttrHours: 300 }),
      life({ totalAvgHours: 720, sampleSize: 30 }),
      bott({ rework: { reworkedTasks: 9, totalReopens: 9, totalRedos: 0, reworkRate: 0.4 }, agingWip: { stuckCount: 8, thresholdHours: 72, oldest: [] } }),
    );
    expect(r.verdict).toBe('no');
    expect(r.score).toBeLessThan(45);
    expect(r.reasons.some((x) => x.key === 'stuck' && x.tone === 'bad')).toBe(true);
  });

  it('drops null DORA keys from the average instead of scoring them zero', () => {
    // Only deployment frequency is known; a healthy cadence should not be dragged
    // down by the missing lead-time/CFR/MTTR signals.
    const r = computeDeliveryVerdict(
      dora({ deploymentFrequencyPerDay: 2, totalDeployments: 60 }),
      life({ totalAvgHours: 72, sampleSize: 20 }),
      bott(),
    );
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.reasons.some((x) => x.key === 'cfr')).toBe(false); // no CFR signal → no CFR reason
  });
});
