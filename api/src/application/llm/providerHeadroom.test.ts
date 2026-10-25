import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOW_HEADROOM_USED_FRACTION,
  _resetMemoryHeadroom,
  createHeadroomObserver,
  headroomFromHeaders,
  isLowHeadroom,
  loadLowHeadroomVendors,
  parseResetDuration,
  recordSeconds,
} from './providerHeadroom';

const NOW = 1_800_000_000_000;
const h = (entries: Record<string, string>) => new Headers(entries);

describe('headroomFromHeaders', () => {
  it('reads a Claude subscription window and its reset', () => {
    const got = headroomFromHeaders(h({
      'anthropic-ratelimit-unified-5h-utilization': '0.94',
      'anthropic-ratelimit-unified-7d-utilization': '0.40',
      'anthropic-ratelimit-unified-reset': String(NOW / 1000 + 1800),
    }), NOW);
    expect(got).toEqual({ usedFraction: 0.94, resetAt: NOW + 1_800_000 });
    expect(isLowHeadroom(got)).toBe(true);
  });

  it('treats a rejected subscription as spent', () => {
    expect(headroomFromHeaders(h({ 'anthropic-ratelimit-unified-status': 'rejected' }), NOW)?.usedFraction).toBe(1);
  });

  it('reads OpenAI-style remaining/limit with a duration reset', () => {
    const got = headroomFromHeaders(h({
      'x-ratelimit-limit-tokens': '1000000',
      'x-ratelimit-remaining-tokens': '50000',
      'x-ratelimit-reset-tokens': '6m0s',
    }), NOW);
    expect(got?.usedFraction).toBeCloseTo(0.95, 6);
    expect(got?.resetAt).toBe(NOW + 360_000);
  });

  it('reads the Codex subscription percentages', () => {
    const got = headroomFromHeaders(h({ 'x-codex-primary-used-percent': '97', 'x-codex-primary-reset-after-seconds': '120' }), NOW);
    expect(got).toEqual({ usedFraction: 0.97, resetAt: NOW + 120_000 });
  });

  it('the most-used window decides', () => {
    const reset = new Date(NOW + 3_600_000).toISOString();
    const got = headroomFromHeaders(h({
      'anthropic-ratelimit-tokens-limit': '100', 'anthropic-ratelimit-tokens-remaining': '80', 'anthropic-ratelimit-tokens-reset': reset,
      'anthropic-ratelimit-requests-limit': '100', 'anthropic-ratelimit-requests-remaining': '5', 'anthropic-ratelimit-requests-reset': reset,
    }), NOW);
    expect(got?.usedFraction).toBeCloseTo(0.95, 6);
  });

  it('a per-minute throughput bucket is not account quota', () => {
    expect(headroomFromHeaders(h({
      'x-ratelimit-limit-tokens': '30000', 'x-ratelimit-remaining-tokens': '100', 'x-ratelimit-reset-tokens': '45s',
    }), NOW)).toBeNull();
    expect(headroomFromHeaders(h({
      'anthropic-ratelimit-tokens-limit': '100', 'anthropic-ratelimit-tokens-remaining': '1',
    }), NOW)).toBeNull();
  });

  it('reads each family in its own unit: Codex 1% is 1%, Claude overage is spent', () => {
    expect(headroomFromHeaders(h({ 'x-codex-primary-used-percent': '1' }), NOW)?.usedFraction).toBeCloseTo(0.01, 6);
    expect(headroomFromHeaders(h({ 'x-codex-primary-used-percent': '0.5' }), NOW)?.usedFraction).toBeCloseTo(0.005, 6);
    expect(headroomFromHeaders(h({ 'anthropic-ratelimit-unified-5h-utilization': '1.2' }), NOW)?.usedFraction).toBe(1);
  });

  it('is null when the response says nothing about quota', () => {
    expect(headroomFromHeaders(h({ 'content-type': 'text/event-stream' }), NOW)).toBeNull();
  });

  it('an account with room left keeps leading', () => {
    expect(isLowHeadroom({ usedFraction: LOW_HEADROOM_USED_FRACTION - 0.01, resetAt: null })).toBe(false);
  });
});

describe('parseResetDuration / recordSeconds', () => {
  it('parses OpenAI durations', () => {
    expect(parseResetDuration('1.5s')).toBe(1500);
    expect(parseResetDuration('20ms')).toBe(20);
    expect(parseResetDuration('1h2m')).toBe(3_720_000);
    expect(parseResetDuration('nonsense')).toBeNull();
  });

  it('lives until the window resets, within bounds', () => {
    expect(recordSeconds({ usedFraction: 1, resetAt: NOW + 600_000 }, NOW)).toBe(600);
    expect(recordSeconds({ usedFraction: 1, resetAt: NOW + 1000 }, NOW)).toBe(60);
    expect(recordSeconds({ usedFraction: 1, resetAt: NOW + 7 * 86_400_000 }, NOW)).toBe(21_600);
    expect(recordSeconds({ usedFraction: 1, resetAt: null }, NOW)).toBe(900);
  });
});

describe('createHeadroomObserver → loadLowHeadroomVendors', () => {
  beforeEach(_resetMemoryHeadroom);
  const env = {};

  it('records a nearly-spent OWNER account and the resolver then demotes it', async () => {
    const observe = createHeadroomObserver(env, 77, (m) => m.startsWith('direct/') || m.startsWith('anthropic/'));
    await observe('anthropic/claude-opus-5', 'anthropic', h({ 'anthropic-ratelimit-unified-5h-utilization': '0.97' }));
    expect(observe('direct/minimax/MiniMax-M3', 'minimax', h({ 'x-codex-primary-used-percent': '60' }))).toBeNull();
    expect([...await loadLowHeadroomVendors(env, 77, ['anthropic', 'minimax'])]).toEqual(['anthropic']);
  });

  it('never records an operator-pool attempt, or a call with no tenant', async () => {
    const pool = createHeadroomObserver(env, 78, () => false);
    expect(pool('nvidia/x:free', 'nvidia', h({ 'x-codex-primary-used-percent': '99' }))).toBeNull();
    expect((await loadLowHeadroomVendors(env, 78, ['nvidia'])).size).toBe(0);

    const noTenant = createHeadroomObserver(env, null, () => true);
    expect(noTenant('anthropic/claude-opus-5', 'anthropic', h({ 'anthropic-ratelimit-unified-status': 'rejected' }))).toBeNull();
    expect((await loadLowHeadroomVendors(env, 79, ['anthropic'])).size).toBe(0);
  });
});
