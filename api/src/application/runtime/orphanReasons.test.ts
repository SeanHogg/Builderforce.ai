/**
 * cloudOrphanReason — picks the "died early" reason vs. the long-lived-crash reason
 * from how long a reaped cloud run actually made progress. The bug this guards: a
 * container/durable run that ran 60-90s was being told it hit a "~30s serverless
 * limit" and to "downgrade to a durable runtime" — both false.
 */
import { describe, expect, it } from 'vitest';
import {
  cloudOrphanReason,
  cloudSilenceCeilingMs,
  CLOUD_ORPHAN_REASON,
  CLOUD_LONG_LIVED_ORPHAN_REASON,
  CLOUD_LONG_LIVED_SILENCE_MS,
  SERVERLESS_WALL_MS,
  isInfrastructureEviction,
} from './orphanReasons';

const start = 1_000_000_000_000;

describe('cloudOrphanReason', () => {
  it('returns the long-lived crash reason when progress outlasted the serverless wall', () => {
    // execution #62: started 23:26:24, last activity 23:27:41 → ~77s.
    expect(cloudOrphanReason(start, start + 77_000)).toBe(CLOUD_LONG_LIVED_ORPHAN_REASON);
  });

  it('returns the died-early reason for a run that stopped almost immediately', () => {
    expect(cloudOrphanReason(start, start + 6_000)).toBe(CLOUD_ORPHAN_REASON);
  });

  it('treats the wall itself as died-early (boundary is exclusive)', () => {
    expect(cloudOrphanReason(start, start + SERVERLESS_WALL_MS)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(start, start + SERVERLESS_WALL_MS + 1)).toBe(CLOUD_LONG_LIVED_ORPHAN_REASON);
  });

  it('falls back to the died-early reason when timestamps are unknown', () => {
    expect(cloudOrphanReason(null, null)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(start, null)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(undefined, start + 99_000)).toBe(CLOUD_ORPHAN_REASON);
    expect(cloudOrphanReason(NaN, NaN)).toBe(CLOUD_ORPHAN_REASON);
  });
});

describe('cloudSilenceCeilingMs', () => {
  it('every executor gets the long-lived ceiling (a 93s LLM tick must not be reaped — execution #136)', () => {
    expect(cloudSilenceCeilingMs('durable')).toBe(CLOUD_LONG_LIVED_SILENCE_MS);
    expect(cloudSilenceCeilingMs('container')).toBe(CLOUD_LONG_LIVED_SILENCE_MS);
    // 93s (the observed kimi completion) sits comfortably under the ceiling but OVER
    // the old 90s wall that reaped it.
    expect(93_000).toBeGreaterThan(90_000);
    expect(93_000).toBeLessThan(CLOUD_LONG_LIVED_SILENCE_MS);
  });

  it('an unknown/unstamped executor is treated conservatively as long-lived (never reap a live tick)', () => {
    expect(cloudSilenceCeilingMs(undefined)).toBe(CLOUD_LONG_LIVED_SILENCE_MS);
    expect(cloudSilenceCeilingMs(null)).toBe(CLOUD_LONG_LIVED_SILENCE_MS);
    // Includes the removed in-request 'worker' executor: a payload stamped before it
    // was deleted must still get the generous ceiling, not a tight fast-fail.
    expect(cloudSilenceCeilingMs('worker')).toBe(CLOUD_LONG_LIVED_SILENCE_MS);
    expect(cloudSilenceCeilingMs('bogus')).toBe(CLOUD_LONG_LIVED_SILENCE_MS);
  });
});

/**
 * A PLATFORM eviction is not a run failure. Cloudflare resets every live Durable
 * Object when a new Worker version deploys, so one release interrupts every
 * in-flight cloud run at once — and those interruptions used to be written as
 * terminal failures that each spent a strike against the 3-failure autonomy
 * breaker. Measured on task 683: 3 of its 5 failures were one deploy.
 */
describe('isInfrastructureEviction', () => {
  it('recognises the platform messages that mean "we took the runtime away"', () => {
    const evictions = [
      'Durable Object reset because its code was updated.',
      'The Durable Object is overloaded and is being reset.',
      'Error: durable object reset because its code was updated',
      'The execution context was cancelled.',
    ];
    for (const m of evictions) expect(isInfrastructureEviction(m), m).toBe(true);
  });

  it('does NOT swallow a real run failure', () => {
    const realFailures = [
      'Gateway 400 on model \'direct/meta/muse-spark-1.1\'',
      CLOUD_ORPHAN_REASON,
      CLOUD_LONG_LIVED_ORPHAN_REASON,
      'Monthly cloud-run allowance reached (30/25 on the free plan).',
      'The agent could not find the repository.',
      '',
      null,
      undefined,
    ];
    for (const m of realFailures) expect(isInfrastructureEviction(m), String(m)).toBe(false);
  });
});
