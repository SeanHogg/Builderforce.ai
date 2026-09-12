import { describe, expect, it } from 'vitest';
import { tierCfr, tierDeployFreq, tierLeadTime, tierMttr } from './doraTiers';

describe('DORA tier classification (0 = Elite … 3 = Low)', () => {
  it('deployment frequency: daily / weekly / monthly / less', () => {
    expect([1, 1 / 7, 1 / 30, 1 / 31].map(tierDeployFreq)).toEqual([0, 1, 2, 3]);
  });

  it('lead time: under a day / week / month, else Low', () => {
    expect([23.9, 24, 168, 730].map(tierLeadTime)).toEqual([0, 1, 2, 3]);
  });

  it('change-failure rate: ≤5 / ≤15 / ≤30 / above', () => {
    expect([5, 15, 30, 30.1].map(tierCfr)).toEqual([0, 1, 2, 3]);
  });

  it('time to restore: under an hour / day / week, else Low', () => {
    expect([0.9, 1, 24, 168].map(tierMttr)).toEqual([0, 1, 2, 3]);
  });
});
