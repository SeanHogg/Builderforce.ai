import { describe, expect, it } from 'vitest';
import {
  assertToolConsented,
  filterConsentedTools,
  isToolConsented,
  McpToolNotConsentedError,
  normalizeAllowedTools,
} from './mcpToolConsent';

describe('isToolConsented', () => {
  it('null/undefined means every tool is consented (pre-consent default)', () => {
    expect(isToolConsented(null, 'anything')).toBe(true);
    expect(isToolConsented(undefined, 'anything')).toBe(true);
  });
  it('an empty array withholds every tool', () => {
    expect(isToolConsented([], 'lookup')).toBe(false);
  });
  it('a populated array is an exact-name allowlist', () => {
    expect(isToolConsented(['lookup'], 'lookup')).toBe(true);
    expect(isToolConsented(['lookup'], 'delete')).toBe(false);
  });
});

describe('filterConsentedTools', () => {
  const tools = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  it('keeps everything when unrestricted', () => {
    expect(filterConsentedTools(null, tools)).toEqual(tools);
  });
  it('keeps only the named subset', () => {
    expect(filterConsentedTools(['a', 'c'], tools).map((t) => t.name)).toEqual(['a', 'c']);
  });
});

describe('assertToolConsented', () => {
  it('throws McpToolNotConsentedError for a withheld tool', () => {
    expect(() => assertToolConsented(['a'], 'b')).toThrow(McpToolNotConsentedError);
  });
  it('does not throw for a consented tool', () => {
    expect(() => assertToolConsented(['a'], 'a')).not.toThrow();
  });
});

describe('normalizeAllowedTools', () => {
  it('null stays null (clears the restriction)', () => {
    expect(normalizeAllowedTools(null)).toBeNull();
  });
  it('dedupes and strips blanks', () => {
    expect(normalizeAllowedTools(['a', 'a', ' ', '', 'b'])).toEqual(['a', 'b']);
  });
  it('rejects anything that is not an array or null', () => {
    expect(() => normalizeAllowedTools('a')).toThrow();
    expect(() => normalizeAllowedTools(undefined)).toThrow();
    expect(() => normalizeAllowedTools(42)).toThrow();
  });
});
