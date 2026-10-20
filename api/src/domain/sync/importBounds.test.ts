import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPORT_PAGE_MAX, boundImportPage } from './importBounds';

describe('boundImportPage', () => {
  it('defaults the hard cap to 500, matching the client pull cap', () => {
    expect(DEFAULT_IMPORT_PAGE_MAX).toBe(500);
    expect(boundImportPage()).toBe(500);
    expect(boundImportPage(undefined)).toBe(500);
  });

  it('replaces a missing, non-finite, or non-positive request with the cap', () => {
    expect(boundImportPage(undefined, 200)).toBe(200);
    expect(boundImportPage(Number.NaN)).toBe(500);
    expect(boundImportPage(Number.POSITIVE_INFINITY)).toBe(500);
    expect(boundImportPage(Number.NEGATIVE_INFINITY)).toBe(500);
    expect(boundImportPage(0)).toBe(500);
    expect(boundImportPage(-1)).toBe(500);
    expect(boundImportPage(-0)).toBe(500);
  });

  it('clamps a request above the hard max and keeps one at or under it', () => {
    expect(boundImportPage(501)).toBe(500);
    expect(boundImportPage(1_000_000)).toBe(500);
    expect(boundImportPage(500)).toBe(500);
    expect(boundImportPage(1)).toBe(1);
    expect(boundImportPage(499)).toBe(499);
    expect(boundImportPage(12.5, 20)).toBe(12.5);
    expect(boundImportPage(20, 20)).toBe(20);
    expect(boundImportPage(21, 20)).toBe(20);
  });

  it('never returns Infinity, even when the caller asks for an unlimited page', () => {
    const unlimited = [
      boundImportPage(Number.POSITIVE_INFINITY),
      boundImportPage(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
      boundImportPage(undefined, Number.POSITIVE_INFINITY),
      boundImportPage(1e308, Number.POSITIVE_INFINITY),
      boundImportPage(Number.NaN, Number.NaN),
      boundImportPage(10, 0),
      boundImportPage(10, -5),
    ];
    for (const page of unlimited) {
      expect(Number.isFinite(page)).toBe(true);
      expect(page).not.toBe(Number.POSITIVE_INFINITY);
      expect(page).toBeLessThanOrEqual(DEFAULT_IMPORT_PAGE_MAX);
      expect(page).toBeGreaterThan(0);
    }
  });
});
