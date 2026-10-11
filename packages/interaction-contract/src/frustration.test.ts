import { describe, expect, it } from 'vitest';
import {
  isDeadClickCandidate,
  isExcessiveScroll,
  isInteractiveElement,
  isQuickBack,
  isRageClick,
} from './frustration';
import type { SelectorElement } from './selector';

function el(tag: string, attrs: Record<string, string> = {}): SelectorElement {
  return {
    tagName: tag.toUpperCase(),
    id: '',
    nodeType: 1,
    textContent: '',
    parentElement: null,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
}

describe('isRageClick', () => {
  it('is false below three clicks', () => {
    expect(isRageClick([
      { t: 0, x: 10, y: 10 },
      { t: 100, x: 11, y: 11 },
    ])).toBe(false);
  });

  it('is true for three clicks inside 3s and 24px', () => {
    expect(isRageClick([
      { t: 0, x: 100, y: 100 },
      { t: 400, x: 110, y: 105 },
      { t: 900, x: 95, y: 108 },
    ])).toBe(true);
  });

  it('is false when clicks are far apart in space', () => {
    expect(isRageClick([
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 200, y: 0 },
      { t: 200, x: 400, y: 0 },
    ])).toBe(false);
  });

  it('is false when clicks are far apart in time', () => {
    expect(isRageClick([
      { t: 0, x: 10, y: 10 },
      { t: 4_000, x: 10, y: 10 },
      { t: 8_000, x: 10, y: 10 },
    ])).toBe(false);
  });
});

describe('isDeadClickCandidate', () => {
  it('is true for a plain div', () => {
    expect(isDeadClickCandidate(el('div'))).toBe(true);
    expect(isInteractiveElement(el('div'))).toBe(false);
  });

  it('is false for buttons, links, and role=button', () => {
    expect(isDeadClickCandidate(el('button'))).toBe(false);
    expect(isDeadClickCandidate(el('a', { href: '/x' }))).toBe(false);
    expect(isDeadClickCandidate(el('div', { role: 'button' }))).toBe(false);
  });

  it('is false when there is a click-handler hint', () => {
    expect(isDeadClickCandidate(el('div', { onclick: 'go()' }))).toBe(false);
  });
});

describe('isQuickBack', () => {
  it('detects A→B→A within 7s of leaving A', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/b', t: 1_000 },
      { path: '/a', t: 3_000 },
    ])).toBe(true);
  });

  it('is false when the return is slow', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/b', t: 1_000 },
      { path: '/a', t: 10_000 },
    ])).toBe(false);
  });

  it('is false for A→A (no leave)', () => {
    expect(isQuickBack([
      { path: '/a', t: 0 },
      { path: '/a', t: 1_000 },
      { path: '/a', t: 2_000 },
    ])).toBe(false);
  });
});

describe('isExcessiveScroll', () => {
  it('detects three direction reversals inside 5s', () => {
    expect(isExcessiveScroll([
      { t: 0, y: 0 },
      { t: 200, y: 400 },
      { t: 400, y: 100 },
      { t: 600, y: 500 },
      { t: 800, y: 50 },
    ])).toBe(true);
  });

  it('detects three viewport-heights of travel inside 10s', () => {
    expect(isExcessiveScroll(
      [
        { t: 0, y: 0 },
        { t: 1_000, y: 2_500 },
      ],
      { viewportHeight: 800 },
    )).toBe(true);
  });

  it('is false for a short one-way scroll', () => {
    expect(isExcessiveScroll([
      { t: 0, y: 0 },
      { t: 400, y: 200 },
    ])).toBe(false);
  });
});
