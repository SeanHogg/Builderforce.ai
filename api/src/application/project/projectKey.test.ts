import { describe, it, expect } from 'vitest';
import { buildProjectKey } from './projectKey';

describe('buildProjectKey', () => {
  it('slugifies a normal name', () => {
    expect(buildProjectKey(1, 'Acme App')).toBe('1-ACME-APP');
  });

  it('falls back to PROJECT for an empty/blank name', () => {
    expect(buildProjectKey(1, '')).toBe('1-PROJECT');
    expect(buildProjectKey(1, '   ')).toBe('1-PROJECT');
    expect(buildProjectKey(1, '!!!')).toBe('1-PROJECT');
  });

  it('collapses an auto-generated "Untitled <timestamp>" placeholder to PROJECT', () => {
    // The live bug: a caller naming projects "Untitled <Date.now()>" produced
    // junk keys like `1-UNTITLED-1773010025035`.
    expect(buildProjectKey(1, 'Untitled 1773010025035')).toBe('1-PROJECT');
    expect(buildProjectKey(1, 'untitled')).toBe('1-PROJECT');
    expect(buildProjectKey(1, 'Untitled')).toBe('1-PROJECT');
    expect(buildProjectKey(1, 'untitled-123')).toBe('1-PROJECT');
    expect(buildProjectKey(2, 'Untitled   ')).toBe('2-PROJECT');
  });

  it('keeps a real name that merely starts with "Untitled"', () => {
    expect(buildProjectKey(1, 'Untitled Symphony')).toBe('1-UNTITLED-SYMPHONY');
  });

  it('caps the whole key at 50 chars', () => {
    const key = buildProjectKey(1, 'x'.repeat(80));
    expect(key.length).toBeLessThanOrEqual(50);
  });
});
