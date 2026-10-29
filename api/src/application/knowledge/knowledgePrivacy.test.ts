/**
 * knowledgePrivacy applies memory's quote bound (lines AND characters) — the bound itself is
 * memory's, so these tests state it by its exported constants, never by a copy of the numbers.
 */
import { describe, expect, it } from 'vitest';
import { MAX_QUOTE_CHARS, MAX_QUOTE_LINES } from '@seanhogg/builderforce-memory/knowledge';
import { clampClaim } from './knowledgePrivacy';

describe('clampClaim', () => {
  it('keeps at most MAX_QUOTE_LINES lines of a claim', () => {
    const lines = Array.from({ length: MAX_QUOTE_LINES + 2 }, (_, i) => `l${i + 1}`);
    expect(clampClaim(lines.join('\n')).split('\n')).toEqual(lines.slice(0, MAX_QUOTE_LINES));
  });

  it('caps a one-line claim at MAX_QUOTE_CHARS characters', () => {
    expect(clampClaim('x'.repeat(20_000))).toHaveLength(MAX_QUOTE_CHARS);
  });

  it('leaves a short claim as it is', () => {
    expect(clampClaim('a says b')).toBe('a says b');
  });
});
