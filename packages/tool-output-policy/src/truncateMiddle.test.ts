import { describe, expect, it } from 'vitest';
import { truncateMiddle } from './index.js';

const hasLoneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
};

describe('truncateMiddle', () => {
  it('passes text within the budget through untouched', () => {
    expect(truncateMiddle('short', 5)).toBe('short');
    expect(truncateMiddle('short', 5, { marker: '...' })).toBe('short');
  });

  describe('default marker (omitted-count line)', () => {
    it('keeps both ends, names the real omitted count and stays within max', () => {
      const text = `START${'m'.repeat(10_000)}END`;
      const out = truncateMiddle(text, 500);
      expect(out.length).toBeLessThanOrEqual(500);
      expect(out.startsWith('START')).toBe(true);
      expect(out.endsWith('END')).toBe(true);
      const match = out.match(/\n…\(([\d,]+) chars omitted from the middle\)…\n/);
      expect(match).not.toBeNull();
      const omitted = Number(match![1].replace(/,/g, ''));
      expect(out.length - match![0].length + omitted).toBe(text.length);
    });

    it('gives the head the odd character', () => {
      const out = truncateMiddle('a'.repeat(50) + 'b'.repeat(50), 70);
      const [head, tail] = out.split(/\n…\(.*\)…\n/);
      expect(head.length - tail.length).toBe(1);
    });

    it('returns the head alone when the budget cannot hold the marker', () => {
      expect(truncateMiddle('x'.repeat(100), 10)).toBe('x'.repeat(10));
    });
  });

  describe('string marker', () => {
    it('joins symmetric halves with the marker verbatim', () => {
      expect(truncateMiddle('abcdefghijklmnop', 10, { marker: '...', symmetric: true })).toBe('abc...nop');
      expect(truncateMiddle('abcdefghijklmnop', 9, { marker: '...', symmetric: true })).toBe('abc...nop');
    });

    it('a function marker receives the omitted count', () => {
      expect(truncateMiddle('abcdefghij', 6, { marker: (n) => `[${n}]` })).toBe('a[8]j');
    });

    it('never returns the whole string when the tail share is zero', () => {
      expect(truncateMiddle('abcdefghij', 4, { marker: '...', symmetric: true })).toBe('...');
      expect(truncateMiddle('abcdefghij', 3, { marker: '...' })).toBe('abc');
    });
  });

  describe('surrogate pairs', () => {
    const emoji = '\u{1F600}'; // two UTF-16 code units

    it('never splits a pair at the head or tail cut (string marker)', () => {
      const text = emoji.repeat(40);
      for (let max = 4; max < 40; max++) {
        const out = truncateMiddle(text, max, { marker: '...', symmetric: true });
        expect(out.length).toBeLessThanOrEqual(max);
        expect(hasLoneSurrogate(out)).toBe(false);
      }
    });

    it('never splits a pair at the head or tail cut (default marker)', () => {
      const text = emoji.repeat(400);
      for (let max = 1; max < 120; max++) {
        const out = truncateMiddle(text, max);
        expect(out.length).toBeLessThanOrEqual(max);
        expect(hasLoneSurrogate(out)).toBe(false);
      }
    });
  });
});
