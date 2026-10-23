import { describe, expect, it } from 'vitest';
import {
  costAlertHourKey, isRunCostOutlier, runCostOutlierMessage, spendSpikeMessage, spendSpikeVerdict,
  SPEND_BASELINE_FLOOR_USD,
} from './costAlertRules';

describe('spendSpikeVerdict', () => {
  it('fires above 2x the 14-day median', () => {
    const prior = Array<number>(14).fill(10);
    expect(spendSpikeVerdict(21, prior)).toMatchObject({ spike: true, medianUsd: 10, thresholdUsd: 20 });
    expect(spendSpikeVerdict(20, prior).spike).toBe(false);
  });

  it('fills missing days with $0 and floors the baseline so a first dollar never pages', () => {
    const v = spendSpikeVerdict(1.5, [30, 40]);
    expect(v.medianUsd).toBe(0);
    expect(v.thresholdUsd).toBe(2 * SPEND_BASELINE_FLOOR_USD);
    expect(v.spike).toBe(false);
    expect(spendSpikeVerdict(2.5, []).spike).toBe(true);
  });
});

describe('isRunCostOutlier', () => {
  it('fires above 3x the action-type p90, with a minimum cost', () => {
    expect(isRunCostOutlier(3.1, 1)).toBe(true);
    expect(isRunCostOutlier(3, 1)).toBe(false);
    expect(isRunCostOutlier(0.4, 0.1)).toBe(false);
    expect(isRunCostOutlier(5, 0)).toBe(false);
  });
});

describe('cost alert copy + gate', () => {
  it('keys the hourly gate on the UTC hour', () => {
    expect(costAlertHourKey(Date.UTC(2026, 9, 22, 13, 59))).toBe('cron:cost-alerts:2026-10-22T13');
    expect(costAlertHourKey(Date.UTC(2026, 9, 22, 14, 0))).toBe('cron:cost-alerts:2026-10-22T14');
  });

  it('names the figures in the messages', () => {
    expect(spendSpikeMessage(42, spendSpikeVerdict(42, Array<number>(14).fill(10)))).toContain('$42.00');
    expect(runCostOutlierMessage(7, 'feature', 9, 2)).toBe('Run #7 (feature) cost $9.00 — more than 3x the 30-day p90 for feature runs ($2.00).');
  });
});
