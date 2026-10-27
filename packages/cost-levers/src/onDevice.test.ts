import { describe, expect, it } from 'vitest';
import { costLeverBucket, isCostLeverOn, isOnDeviceCostLeverOn, onDeviceLeverSubject } from './index';

describe('on-device lever bucketing', () => {
  it('a partial rollout reaches about its share of installs instead of none', () => {
    let on = 0;
    for (let i = 0; i < 2000; i++) if (isOnDeviceCostLeverOn({}, 'c8_token_compression', `machine-${i}`)) on++;
    // c8 ships at 10%.
    expect(on / 2000).toBeGreaterThan(0.06);
    expect(on / 2000).toBeLessThan(0.14);
  });

  it('one install stays in one arm', () => {
    const a = isOnDeviceCostLeverOn({}, 'c4_adaptive_context', 'abc123');
    for (let i = 0; i < 5; i++) expect(isOnDeviceCostLeverOn({}, 'c4_adaptive_context', 'abc123')).toBe(a);
  });

  it('buckets the install under its own prefix, never as a bare tenant id', () => {
    expect(onDeviceLeverSubject('abc')).toBe('device:abc');
    const subject = onDeviceLeverSubject('abc')!;
    expect(isOnDeviceCostLeverOn({}, 'c8_token_compression', 'abc')).toBe(costLeverBucket('c8_token_compression', subject) < 10);
  });

  it('no install id keeps the tenant-less answer: on only at 100', () => {
    expect(onDeviceLeverSubject('  ')).toBeNull();
    expect(isOnDeviceCostLeverOn({}, 'c8_token_compression', null)).toBe(false);
    expect(isOnDeviceCostLeverOn({}, 'b1_stable_prefix', undefined)).toBe(true);
    expect(isOnDeviceCostLeverOn({}, 'c8_token_compression', '')).toBe(isCostLeverOn({}, 'c8_token_compression', null));
  });

  it('env overrides win over the install bucket', () => {
    expect(isOnDeviceCostLeverOn({ COST_LEVER_C8_TOKEN_COMPRESSION: 'on' }, 'c8_token_compression', 'x')).toBe(true);
    expect(isOnDeviceCostLeverOn({ COST_LEVER_C8_TOKEN_COMPRESSION: 'off' }, 'c8_token_compression', 'x')).toBe(false);
  });
});
