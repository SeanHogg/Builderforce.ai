import { describe, expect, it } from 'vitest';
import { isMaskedText, isNeverCaptured, maskInputFn, rrwebPrivacyOptions, sanitizeHref } from './masking';

function el(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap.querySelector('[data-target]') ?? (wrap.firstElementChild as HTMLElement);
}

describe('rrwebPrivacyOptions', () => {
  it('always masks inputs and blocks [data-bf-block]', () => {
    const opts = rrwebPrivacyOptions({ maskAllText: false, recordCanvas: false });
    expect(opts.maskAllInputs).toBe(true);
    expect(opts.blockSelector).toBe('[data-bf-block]');
    expect(opts.maskTextSelector).toBe('[data-bf-mask]');
    expect(opts.sampling).toEqual({ mousemove: 50, scroll: 150, input: 'last' });
    expect(opts.recordCanvas).toBe(false);
    expect('dataURLOptions' in opts).toBe(false);
  });

  it('masks every text node when the site asks', () => {
    expect(rrwebPrivacyOptions({ maskAllText: true }).maskTextSelector).toBe('*');
  });

  it('records canvas at 2 fps as JPEG 0.4 only when enabled', () => {
    const opts = rrwebPrivacyOptions({ recordCanvas: true });
    expect(opts.recordCanvas).toBe(true);
    expect(opts.sampling).toMatchObject({ canvas: 2 });
    expect(opts).toMatchObject({ dataURLOptions: { type: 'image/jpeg', quality: 0.4 } });
  });
});

describe('maskInputFn', () => {
  it('never captures passwords or card fields', () => {
    expect(isNeverCaptured(el('<input type="password" />'))).toBe(true);
    expect(isNeverCaptured(el('<input autocomplete="cc-number" />'))).toBe(true);
    expect(maskInputFn('hunter2', el('<input type="password" />'))).toBe('');
    expect(maskInputFn('4111111111111111', el('<input autocomplete="cc-number" />'))).toBe('');
  });

  it('masks other inputs to the same length', () => {
    expect(maskInputFn('secret', el('<input type="text" />'))).toBe('******');
    expect(isNeverCaptured(el('<input type="email" />'))).toBe(false);
  });
});

describe('isMaskedText', () => {
  it('honours data-bf-mask, data-bf-block and maskAllText', () => {
    expect(isMaskedText(el('<div data-bf-mask><span data-target>x</span></div>'), false)).toBe(true);
    expect(isMaskedText(el('<div data-bf-block><b data-target>x</b></div>'), false)).toBe(true);
    expect(isMaskedText(el('<button>Go</button>'), false)).toBe(false);
    expect(isMaskedText(el('<button>Go</button>'), true)).toBe(true);
  });
});

describe('sanitizeHref', () => {
  const base = 'https://shop.example.com/products';

  it('drops the address of mailto/tel links', () => {
    expect(sanitizeHref('mailto:jane@example.com', base)).toBe('mailto:');
    expect(sanitizeHref('tel:+64211234567', base)).toBe('tel:');
  });

  it('keeps a path, never a query or fragment', () => {
    expect(sanitizeHref('/files/a.pdf?token=abc#p2', base)).toBe('/files/a.pdf');
    expect(sanitizeHref('https://other.example/x?y=1', base)).toBe('other.example/x');
  });

  it('drops javascript: and empty targets', () => {
    expect(sanitizeHref('javascript:void(0)', base)).toBeUndefined();
    expect(sanitizeHref('', base)).toBeUndefined();
  });
});
