import { describe, expect, it } from 'vitest';
import { voiceTrustOf } from './voiceTrust';

describe('voiceTrustOf', () => {
  it('trusts the server field when present', () => {
    expect(voiceTrustOf({ trust: 'watermark_only', audioMatchesSignedHash: true })).toBe('watermark_only');
    expect(voiceTrustOf({ trust: 'self_reported' })).toBe('self_reported');
    expect(voiceTrustOf({ trust: 'verified' })).toBe('verified');
  });

  it('falls back to verified only for a hash match on a platform record', () => {
    expect(voiceTrustOf({ audioMatchesSignedHash: true })).toBe('verified');
    expect(voiceTrustOf({ audioMatchesSignedHash: true, selfReported: false })).toBe('verified');
  });

  it('falls back to self_reported for a self-reported record whose audio matches', () => {
    expect(voiceTrustOf({ audioMatchesSignedHash: true, selfReported: true })).toBe('self_reported');
  });

  it('never grants success to a mark alone', () => {
    expect(voiceTrustOf({})).toBe('watermark_only');
    expect(voiceTrustOf({ audioMatchesSignedHash: false })).toBe('watermark_only');
    expect(voiceTrustOf({ selfReported: true })).toBe('watermark_only');
  });

  it('ignores an unknown server value', () => {
    expect(voiceTrustOf({ trust: 'trusted' as never })).toBe('watermark_only');
  });
});
