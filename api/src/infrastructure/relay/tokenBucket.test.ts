import { describe, expect, it } from 'vitest';
import { fullBucket, takeToken } from './tokenBucket';

const RATE = { framesPerSecond: 10, burst: 3 };

describe('takeToken', () => {
  it('spends a full bucket, then refuses', () => {
    const bucket = fullBucket(RATE, 0);
    expect([takeToken(bucket, RATE, 0), takeToken(bucket, RATE, 0), takeToken(bucket, RATE, 0)]).toEqual([true, true, true]);
    expect(takeToken(bucket, RATE, 0)).toBe(false);
  });

  it('refills by elapsed time, capped at the burst', () => {
    const bucket = fullBucket(RATE, 0);
    for (let i = 0; i < 3; i += 1) takeToken(bucket, RATE, 0);
    expect(takeToken(bucket, RATE, 100)).toBe(true); // 100ms at 10/s = one token
    expect(takeToken(bucket, RATE, 100)).toBe(false);
    takeToken(bucket, RATE, 60_000);
    expect(bucket.tokens).toBe(RATE.burst - 1);
  });

  it('treats a clock that goes backwards as no elapsed time', () => {
    const bucket = fullBucket(RATE, 1_000);
    for (let i = 0; i < 3; i += 1) takeToken(bucket, RATE, 1_000);
    expect(takeToken(bucket, RATE, 0)).toBe(false);
  });
});
