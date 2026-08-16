import { describe, it, expect } from 'vitest';
import { pageWindow } from './Pagination';

/**
 * The window is what keeps the pager a control rather than a wall of buttons:
 * the blog's old strip printed every page, which is fine at three and unusable
 * at fifteen. These pin the two properties the rendering depends on — the ends
 * are always reachable, and a gap never hides a page it could have shown.
 */
describe('pageWindow', () => {
  it('prints every page while they fit', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first and last page reachable from anywhere', () => {
    for (const page of [1, 5, 10, 14]) {
      const window = pageWindow(page, 14);
      expect(window[0]).toBe(1);
      expect(window[window.length - 1]).toBe(14);
      expect(window).toContain(page);
    }
  });

  it('only elides a run of two or more pages', () => {
    const window = pageWindow(8, 20);
    const numbers = window.filter((p): p is number => p !== null);
    // A `null` stands between two numbers that are more than one apart, never
    // between neighbours — a gap hiding a single page is a lie about the size.
    window.forEach((entry, i) => {
      if (entry !== null) return;
      const before = window[i - 1] as number;
      const after = window[i + 1] as number;
      expect(after - before).toBeGreaterThan(1);
    });
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('never elides past the ends', () => {
    expect(pageWindow(1, 20)[1]).toBe(2);
    const last = pageWindow(20, 20);
    expect(last[last.length - 2]).toBe(19);
  });
});
