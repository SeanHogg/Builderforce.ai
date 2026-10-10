import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { value: unknown; opts?: { kvTtlSeconds?: number } }>();
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: vi.fn(async (_env: unknown, key: string) => store.get(key)?.value ?? null),
  setCached: vi.fn(async (_env: unknown, key: string, value: unknown, opts?: { kvTtlSeconds?: number }) => {
    store.set(key, { value, opts });
  }),
}));

import {
  DEFAULT_GITHUB_COOLDOWN_SECONDS,
  activeGithubCooldown,
  githubCooldownFor,
  githubCredentialCooldownKey,
  githubRetryAfterSeconds,
  recordGithubCooldown,
} from './githubCredentialCooldown';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const headers = (h: Record<string, string>) => new Headers(h);
const githubError = (status: number, retryAfterSeconds: number | null = null, code = 'GITHUB_HTTP_ERROR') =>
  Object.assign(new Error(`GitHub GraphQL returned HTTP ${status}`), { code, details: { status, retryAfterSeconds } });

beforeEach(() => store.clear());

describe('githubRetryAfterSeconds', () => {
  it('honours retry-after in seconds', () => {
    expect(githubRetryAfterSeconds(headers({ 'retry-after': '120' }), NOW)).toBe(120);
  });

  it('honours retry-after as an HTTP date', () => {
    expect(githubRetryAfterSeconds(headers({ 'retry-after': new Date(NOW + 300_000).toUTCString() }), NOW)).toBe(300);
  });

  it('honours x-ratelimit-reset only when the window is exhausted', () => {
    const reset = String(NOW / 1000 + 900);
    expect(githubRetryAfterSeconds(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), NOW)).toBe(900);
    expect(githubRetryAfterSeconds(headers({ 'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': reset }), NOW)).toBeNull();
  });

  it('clamps to [60s, 6h] and returns null with no hint', () => {
    expect(githubRetryAfterSeconds(headers({ 'retry-after': '1' }), NOW)).toBe(60);
    expect(githubRetryAfterSeconds(headers({ 'retry-after': String(3 * 86_400) }), NOW)).toBe(6 * 3600);
    expect(githubRetryAfterSeconds(headers({}), NOW)).toBeNull();
  });
});

describe('githubCooldownFor', () => {
  it('cools a 403 or 429 for the default when GitHub gave no hint', () => {
    expect(githubCooldownFor(githubError(403))).toBe(DEFAULT_GITHUB_COOLDOWN_SECONDS);
    expect(githubCooldownFor(githubError(429))).toBe(DEFAULT_GITHUB_COOLDOWN_SECONDS);
  });

  it('uses the header-derived hint when present', () => {
    expect(githubCooldownFor(githubError(403, 900))).toBe(900);
  });

  it('cools a GraphQL "API rate limit exceeded" reported with HTTP 200', () => {
    const e = Object.assign(new Error('API rate limit exceeded for user ID 1.'), { code: 'GITHUB_GRAPHQL_ERROR', details: {} });
    expect(githubCooldownFor(e)).toBe(DEFAULT_GITHUB_COOLDOWN_SECONDS);
  });

  it('does not cool 5xx, non-GitHub failures or plain errors', () => {
    expect(githubCooldownFor(githubError(502))).toBeNull();
    expect(githubCooldownFor(githubError(403, null, 'CREDENTIAL_RESOLUTION_FAILED'))).toBeNull();
    expect(githubCooldownFor(new Error('boom'))).toBeNull();
    expect(githubCooldownFor(null)).toBeNull();
  });
});

describe('credential cooldown record', () => {
  it('is active until it lapses, keyed by credential, with a matching KV TTL', async () => {
    await recordGithubCooldown(undefined, 'cred-1', 900, { status: 403, reason: 'HTTP 403' }, NOW);
    expect(store.get(githubCredentialCooldownKey('cred-1'))?.opts?.kvTtlSeconds).toBe(900);
    expect(await activeGithubCooldown(undefined, 'cred-1', NOW + 60_000)).toMatchObject({ status: 403 });
    expect(await activeGithubCooldown(undefined, 'cred-1', NOW + 901_000)).toBeNull();
    expect(await activeGithubCooldown(undefined, 'cred-2', NOW)).toBeNull();
  });
});
