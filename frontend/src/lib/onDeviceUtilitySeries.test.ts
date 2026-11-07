import { describe, expect, it } from 'vitest';
import { onDeviceUtilitySeries, type CostGroupMetrics, type CostMetricsReport } from './costMetricsApi';

const group = (g: string, calls: number): CostGroupMetrics => ({
  group: g, calls, costUsd: 0, cacheHitRate: null, outputInputRatio: null, reasoningShare: null,
  medianContextTokens: null, completedRuns: 0, medianTurnsPerCompletedRun: null, mergedRuns: 0,
  costPerMergedPrUsd: null, medianCostPerMergedPrUsd: null,
});
const report = (groups: CostGroupMetrics[]): CostMetricsReport =>
  ({ window: '7d', windowDays: 7, groupBy: 'utilityEngine', basis: 'provider_reported', truncated: false, groups });

describe('onDeviceUtilitySeries', () => {
  it('drops non-utility rows and shares the device engines over all utility calls', () => {
    const s = onDeviceUtilitySeries(report([group('synapse', 30), group('bfi', 10), group('cloud', 60), group('other', 500)]));
    expect(s.groups.map((g) => g.group)).toEqual(['synapse', 'bfi', 'cloud']);
    expect(s.onDeviceCalls).toBe(40);
    expect(s.totalCalls).toBe(100);
    expect(s.share).toBeCloseTo(0.4);
  });

  it('has no share when there were no utility calls', () => {
    expect(onDeviceUtilitySeries(report([group('other', 9)])).share).toBeNull();
    expect(onDeviceUtilitySeries(null).share).toBeNull();
  });
});
