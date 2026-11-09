import { describe, expect, it } from 'vitest';
import {
  OUTLINE_FIRST_MIN_CHARS,
  OUTLINE_FIRST_MIN_LINES,
  OUTLINE_FIRST_PREFIX_LINES,
  outlineFirstContinuationNote,
  shouldOutlineFirst,
} from './outlineFirst.js';

describe('shouldOutlineFirst (B2 — outline-first reads)', () => {
  it('outline-first on a first whole-file read of a large file, lever on', () => {
    expect(shouldOutlineFirst({ sizeChars: OUTLINE_FIRST_MIN_CHARS + 1, sizeLines: 10, leverOn: true })).toBe(true);
    expect(shouldOutlineFirst({ sizeChars: 100, sizeLines: OUTLINE_FIRST_MIN_LINES + 1, leverOn: true })).toBe(true);
    // Exactly at the threshold counts as "at or over".
    expect(shouldOutlineFirst({ sizeChars: OUTLINE_FIRST_MIN_CHARS, sizeLines: 1, leverOn: true })).toBe(true);
  });

  it('regression: chat #216 — a large read with NO offset returns an outline, not the whole file', () => {
    // The lever-on path is the gate the host applies; the regression is that a >cap
    // first read takes the outline branch instead of paging the file at the model.
    const big = { sizeChars: 40_000, sizeLines: 900, leverOn: true };
    expect(shouldOutlineFirst(big)).toBe(true);
    // With an offset it is an explicit page — the caller asked for that window.
    expect(shouldOutlineFirst({ ...big, hasOffset: true })).toBe(false);
  });

  it('lever off leaves every read unchanged', () => {
    const big = { sizeChars: 40_000, sizeLines: 900 };
    expect(shouldOutlineFirst({ ...big, leverOn: false })).toBe(false);
    expect(shouldOutlineFirst(big)).toBe(false); // absent lever = unchanged
  });

  it('an explicit offset or limit always reads that window, even on a huge file', () => {
    const big = { sizeChars: 80_000, sizeLines: 2000, leverOn: true };
    expect(shouldOutlineFirst({ ...big, hasOffset: true })).toBe(false);
    expect(shouldOutlineFirst({ ...big, hasLimit: true })).toBe(false);
    expect(shouldOutlineFirst({ ...big, hasOffset: true, hasLimit: true })).toBe(false);
  });

  it('a small file reads normally even with the lever on', () => {
    expect(shouldOutlineFirst({ sizeChars: 900, sizeLines: 40, leverOn: true })).toBe(false);
    expect(shouldOutlineFirst({ sizeChars: OUTLINE_FIRST_MIN_CHARS - 1, sizeLines: OUTLINE_FIRST_MIN_LINES - 1, leverOn: true })).toBe(false);
  });

  it('the continuation note names the offset right after the 40-line prefix', () => {
    const note = outlineFirstContinuationNote(900);
    expect(note).toMatch(/`outline`/);
    expect(note).toMatch(new RegExp(`first ${OUTLINE_FIRST_PREFIX_LINES} lines`));
    expect(note).toMatch(/offset/);
    expect(note).toMatch(new RegExp(`offset ${OUTLINE_FIRST_PREFIX_LINES + 1}`));
  });
});
