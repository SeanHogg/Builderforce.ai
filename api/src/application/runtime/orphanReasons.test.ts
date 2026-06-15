/**
 * cloudOrphanReason — picks the serverless ~30s reason vs. the long-lived-crash
 * reason from how long a reaped cloud run actually made progress. The bug this
 * guards: a container/durable run that ran 60-90s was being told it hit a "~30s
 * serverless limit" and to "downgrade to a durable runtime" — both false.
 */
import { describe, expect, it } from 'vitest';
import {
  cloudOrphanReason,
  CLOUD_ORPHAN_REASON,
  CLOUD_LONG_LIVED_ORPHAN_REASON,
  SERVERLESS_WALL_MS,
} from './orphanReasons';

const start = 1_000_000_000_000;

describe('cloudOrphanReason', () => {
  it('returns the long-lived crash reason when progress outlasted the serverless wall', () => {
    // execution #62: started 23:26:24, last activity 23:27:41 → ~77s.
    expect(cloudOrphanReason(start, start + 77_000)).toBe(CLOUD_LONG_LIVED_ORPHAN_REASON);
  });

  it('returns the serverless reason for a short-lived Worker-loop death', () => {
    expect(cloudOrphanReason(start, start + 6_000)).toBe(CLOUD_ORPHAN_REASON);
  });

  it('treats the wall itself as serverless (boundary is exclusive)', () => {
    expect(cloudOrphanReason(start, start + SERVERLESS_WALL_MS)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(start, start + SERVERLESS_WALL_MS + 1)).toBe(CLOUD_LONG_LIVED_ORPHAN_REASON);
  });

  it('falls back to the serverless reason when timestamps are unknown', () => {
    expect(cloudOrphanReason(null, null)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(start, null)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(undefined, start + 99_000)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(NaN, NaN)).toBe(CLOUD_ORPHAN_REASON);
  });
});
