import { describe, expect, it } from 'vitest';
import {
  FRUSTRATION_THRESHOLDS,
  isDeadClickCandidate,
  isExcessiveScroll,
  isQuickBack,
  isRageClick,
} from './frustration';
import type { SelectorElement } from './selector';

function el(tag: string, attrs: Record<string, string> = {}, parent: SelectorElement | null = null): SelectorElement {
  return {
    tagName: tag.toUpperCase(),
    id: '',
    nodeType: 1,
    textContent: '',
    parentElement: parent,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
}

describe('FRUSTRATION_THRESHOLDS', () => {
  it('pins the §3.4 numbers', () => {
    expect(FRUSTRATION_THRESHOLDS.rage).toEqual({ minClicks: 3, windowMs: 700, radiusPx: 30 });
    expect(FRUSTRATION_THRESHOLDS.dead).toEqual({ waitMs: 500 });
    expect(FRUSTRATION_THRESHOLDS.quickBack).toEqual({ maxDwellMs: 7_000 });
    expect(FRUSTRATION_THRESHOLDS.excessiveScroll).toEqual({
      reversals: 3, reversalWindowMs: 5_000, viewportHeights: 3, travelWindowMs: 10_000,
    });
  });
});

describe('isRageClick', () => {
  it('is false below three clicks', () => {
    expect(isRageClick([{ t: 0, x: 10, y: 10 }, { t: 100, x: 11, y: 11 }])).toBe(false);
  });

  it('is true for three clicks inside 700 ms and 30 px of the latest', () => {
    expect(isRageClick([
      { t: 0, x: 100, y: 100 },
      { t: 250, x: 110, y: 105 },
      { t: 600, x: 95, y: 108 },
    ])).toBe(true);
  });

  it('is false when the burst spans more than 700 ms', () => {
    expect(isRageClick([
      { t: 0, x: 10, y: 10 },
      { t: 400, x: 10, y: 10 },
      { t: 800, x: 10, y: 10 },
    ])).toBe(false);
  });

  it('is false when the clicks are more than 30 px apart', () => {
    expect(isRageClick([
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 40, y: 0 },
      { t: 200, x: 80, y: 0 },
    ])).toBe(false);
  });

  it('only counts clicks near the latest one', () => {
    expect(isRageClick([
      { t: 0, x: 500, y: 500 },
      { t: 100, x: 10, y: 10 },
      { t: 200, x: 12, y: 12 },
    ])).toBe(false);
  });
});

describe('isDeadClickCandidate', () => {
  it('is true for a plain div', () => {
    expect(isDeadClickCandidate(el('div'))).toBe(true);
  });

  it('is false for controls, links and ARIA widgets', () => {
    expect(isDeadClickCandidate(el('button'))).toBe(false);
    expect(isDeadClickCandidate(el('a', { href: '/x' }))).toBe(false);
    expect(isDeadClickCandidate(el('div', { role: 'button' }))).toBe(false);
    expect(isDeadClickCandidate(el('div', { onclick: 'go()' }))).toBe(false);
    expect(isDeadClickCandidate(el('div', { tabindex: '0' }))).toBe(false);
  });

  it('is false for a span inside a button', () => {
    expect(isDeadClickCandidate(el('span', {}, el('button')))).toBe(false);
  });
});

describe('isQuickBack', () => {
  it('detects A→B→A with a short stay on B', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/b', t: 1_000 },
      { path: '/a', t: 3_000 },
    ])).toBe(true);
  });

  it('is false when the stay on B is 7 s or longer', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/b', t: 1_000 },
      { path: '/a', t: 8_000 },
    ])).toBe(false);
  });

  it('only looks at the last three entries', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/b', t: 1_000 },
      { path: '/a', t: 2_000 },
      { path: '/c', t: 3_000 },
    ])).toBe(false);
  });

  it('is false for A→A→A', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/a', t: 1_000 },
      { path: '/a', t: 2_000 },
    ])).toBe(false);
  });

  it('honours a custom dwell', () => {
    const pages = [{ path: '/a', t: 0 }, { path: '/b', t: 1_000 }, { path: '/a', t: 3_000 }];
    expect(isQuickBack(pages, { maxDwellMs: 1_000 })).toBe(false);
  });
});

describe('isExcessiveScroll', () => {
  it('detects three reversals inside 5 s', () => {
    expect(isExcessiveScroll([
      { t: 0, y: 0 },
      { t: 200, y: 400 },
      { t: 400, y: 100 },
      { t: 600, y: 500 },
      { t: 800, y: 50 },
    ], 800, null)).toBe(true);
  });

  it('ignores reversals older than 5 s', () => {
    expect(isExcessiveScroll([
      { t: 0, y: 0 },
      { t: 200, y: 400 },
      { t: 400, y: 100 },
      { t: 600, y: 500 },
      { t: 6_000, y: 50 },
    ], 10_000, null)).toBe(false);
  });

  it('detects more than three viewport heights inside 10 s with no click', () => {
    const samples = [{ t: 0, y: 0 }, { t: 2_000, y: 1_500 }, { t: 4_000, y: 2_500 }];
    expect(isExcessiveScroll(samples, 800, null)).toBe(true);
    expect(isExcessiveScroll(samples, 800, 500)).toBe(false);
    expect(isExcessiveScroll(samples, 800, -20_000)).toBe(true);
  });

  it('is false for a short one-way scroll', () => {
    expect(isExcessiveScroll([{ t: 0, y: 0 }, { t: 400, y: 200 }], 800, null)).toBe(false);
  });
});
