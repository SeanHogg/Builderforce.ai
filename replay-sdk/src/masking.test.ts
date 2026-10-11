import { afterEach, describe, expect, it } from 'vitest';
import { isUnmasked, maskInputFn, resetUnmaskForTests, shouldMask, unmask } from './masking';

afterEach(() => resetUnmaskForTests());

function el(html: string): Element {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  return wrap.firstElementChild!;
}

describe('shouldMask', () => {
  it('masks inputs, textareas, password/email/tel, and data-bf-mask', () => {
    expect(shouldMask(el('<input />'))).toBe(true);
    expect(shouldMask(el('<textarea></textarea>'))).toBe(true);
    expect(shouldMask(el('<input type="password" />'))).toBe(true);
    expect(shouldMask(el('<input type="email" />'))).toBe(true);
    expect(shouldMask(el('<div data-bf-mask>x</div>'))).toBe(true);
    expect(shouldMask(el('<input autocomplete="cc-number" />'))).toBe(true);
  });

  it('does not mask a plain button', () => {
    expect(shouldMask(el('<button>Go</button>'))).toBe(false);
  });
});

describe('unmask', () => {
  it('honours data-bf-unmask and API unmask()', () => {
    expect(isUnmasked(el('<input data-bf-unmask />'))).toBe(true);
    unmask('#search');
    expect(isUnmasked(el('<input id="search" />'))).toBe(true);
  });
});

describe('maskInputFn', () => {
  it('replaces text with bullets', () => {
    expect(maskInputFn('secret', el('<input />'))).toBe('••••••');
  });
});
