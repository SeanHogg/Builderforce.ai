import { describe, it, expect, beforeEach } from 'vitest';
import { API_VERSION_PROBE_TIMEOUT_MS, API_VERSION_TTL_MS, fetchApiVersionVia, resetApiVersionCache } from './apiVersion';

/**
 * A BUILD STAMP THAT LIES IS WORSE THAN NO BUILD STAMP.
 *
 * This module exists because "a dump taken minutes BEFORE a deploy is byte-identical to
 * one taken after, so a fixed bug reads as unfixed". The cache it used to hold was set
 * once per page load and never invalidated — which reproduced that exact failure at a
 * longer timescale. Measured 2026-07-29: a capture taken twelve hours after 2026.7.181
 * shipped reported `apiVersion: 2026.7.180`, so fixes that were visibly present in the
 * decision payloads inside the same report were read as never deployed.
 */
describe('fetchApiVersionVia', () => {
  beforeEach(() => resetApiVersionCache());

  it('memoizes within the TTL — the footer, sidebar and a capture cost ONE request', async () => {
    let calls = 0;
    const read = async () => { calls += 1; return { version: '2026.7.181' }; };
    const at = (t: number) => () => t;
    expect(await fetchApiVersionVia(read, at(0))).toBe('2026.7.181');
    expect(await fetchApiVersionVia(read, at(API_VERSION_TTL_MS - 1))).toBe('2026.7.181');
    expect(calls).toBe(1);
  });

  it('re-reads once the TTL lapses, so a long-lived tab cannot stamp a dead build', async () => {
    const versions = ['2026.7.180', '2026.7.181'];
    const read = async () => ({ version: versions.shift() ?? 'exhausted' });
    expect(await fetchApiVersionVia(read, () => 0)).toBe('2026.7.180');
    expect(await fetchApiVersionVia(read, () => API_VERSION_TTL_MS)).toBe('2026.7.181');
  });

  it('an unreachable /health does not extend the life of a stale value', async () => {
    // One failed read must not renew the window — that is how a single blip turns into
    // an indefinitely wrong stamp.
    expect(await fetchApiVersionVia(async () => ({ version: '2026.7.180' }), () => 0)).toBe('2026.7.180');
    expect(await fetchApiVersionVia(async () => { throw new Error('offline'); }, () => API_VERSION_TTL_MS)).toBeNull();
    expect(await fetchApiVersionVia(async () => ({ version: '2026.7.181' }), () => API_VERSION_TTL_MS + 1)).toBe('2026.7.181');
  });

  it('resolves null rather than throwing — a capture must never fail on a version lookup', async () => {
    expect(await fetchApiVersionVia(async () => { throw new Error('offline'); }, () => 0)).toBeNull();
  });

  /**
   * UNREACHABLE and SLOW are different failures. A read that never settles used to
   * leave every awaiting caller hanging forever, which is exactly how "Copy
   * diagnostics" became a button that does nothing: the click lands, the report is
   * never built, and nothing is shown to say so. The bound lives HERE so both
   * surfaces inherit it instead of each host racing its own timer.
   */
  it('abandons a read that never settles, so a stalled /health cannot hang the caller', async () => {
    const never = new Promise<{ version?: string }>(() => {});
    expect(await fetchApiVersionVia(() => never, () => 0, 5)).toBeNull();
  });

  it('a timed-out probe does not poison the cache — the next call re-reads', async () => {
    expect(await fetchApiVersionVia(() => new Promise<{ version?: string }>(() => {}), () => 0, 5)).toBeNull();
    expect(await fetchApiVersionVia(async () => ({ version: '2026.8.1' }), () => 1, 5)).toBe('2026.8.1');
  });

  it('ships a bound by default — an omitted timeout is the shared deadline, not infinity', () => {
    expect(API_VERSION_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(API_VERSION_PROBE_TIMEOUT_MS).toBeLessThan(API_VERSION_TTL_MS);
  });
});
