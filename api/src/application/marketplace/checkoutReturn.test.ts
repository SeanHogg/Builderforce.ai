import { describe, expect, it } from 'vitest';
import { checkoutReturnUrls, InvalidReturnPathError, sameOriginReturnUrl } from './checkoutReturn';

const BASE = 'https://app.example.com/some/page?x=1';

describe('checkoutReturnUrls', () => {
  it('keeps the legacy shape when no returnPath is given (query of returnUrl dropped)', () => {
    expect(checkoutReturnUrls(BASE)).toEqual({
      successUrl: 'https://app.example.com/some/page?checkout={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.example.com/some/page?checkout=cancelled',
    });
  });

  it('preserves the path and query of a relative returnPath, appending checkout', () => {
    expect(checkoutReturnUrls(BASE, '/projects/12?panel=board&tab=settings')).toEqual({
      successUrl: 'https://app.example.com/projects/12?panel=board&tab=settings&checkout={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.example.com/projects/12?panel=board&tab=settings&checkout=cancelled',
    });
  });

  it('drops a stale checkout param from the returnPath', () => {
    expect(checkoutReturnUrls(BASE, '/p?checkout=old&a=1').successUrl)
      .toBe('https://app.example.com/p?a=1&checkout={CHECKOUT_SESSION_ID}');
  });

  it.each(['//evil.example.com/x', 'https://evil.example.com/', '/\\evil.example.com', 'relative/path', '/a\nb'])(
    'refuses %j',
    (bad) => {
      expect(() => checkoutReturnUrls(BASE, bad)).toThrow(InvalidReturnPathError);
    },
  );
});

describe('sameOriginReturnUrl', () => {
  const APP = 'https://app.example.com';
  it('keeps a same-origin return URL', () => {
    expect(sameOriginReturnUrl('https://app.example.com/p?x=1', APP)).toBe('https://app.example.com/p?x=1');
  });
  it('falls back for a foreign origin, a lookalike host, garbage, or nothing', () => {
    expect(sameOriginReturnUrl('https://evil.com/p', APP)).toBe(APP);
    expect(sameOriginReturnUrl('https://app.example.com.evil.com/', APP)).toBe(APP);
    expect(sameOriginReturnUrl('not a url', APP)).toBe(APP);
    expect(sameOriginReturnUrl(undefined, APP)).toBe(APP);
  });
});
