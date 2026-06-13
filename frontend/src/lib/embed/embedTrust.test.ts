import { describe, it, expect } from 'vitest';
import { isTrustedHostOrigin } from './embedTrust';

describe('isTrustedHostOrigin (embed trust boundary) [1462]', () => {
  const allow = ['https://app.burnrateos.com', 'https://staging.burnrateos.com'];

  it('accepts an origin on the allowlist', () => {
    expect(isTrustedHostOrigin('https://app.burnrateos.com', allow, true)).toBe(true);
  });

  it('rejects an origin not on the allowlist (prod or dev)', () => {
    expect(isTrustedHostOrigin('https://evil.example.com', allow, true)).toBe(false);
    expect(isTrustedHostOrigin('https://evil.example.com', allow, false)).toBe(false);
  });

  it('with no allowlist, rejects all origins in production (default-closed)', () => {
    expect(isTrustedHostOrigin('https://anything.com', [], true)).toBe(false);
  });

  it('with no allowlist, accepts in dev (convenience)', () => {
    expect(isTrustedHostOrigin('https://localhost:3001', [], false)).toBe(true);
  });
});
