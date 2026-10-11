import { describe, expect, it } from 'vitest';
import { BUILTIN_SMART_EVENTS, markMatchesRule, matchingSmartEvent } from './smartEvents';

describe('BUILTIN_SMART_EVENTS', () => {
  it('covers thank-you, checkout, buy, signup, demo, subscribe, lead', () => {
    const ids = BUILTIN_SMART_EVENTS.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([
      'conversion.thank-you',
      'conversion.checkout',
      'cta.buy',
      'cta.signup',
      'cta.demo',
      'cta.subscribe',
      'form.lead',
    ]));
  });
});

describe('markMatchesRule', () => {
  const thankYou = BUILTIN_SMART_EVENTS.find((r) => r.id === 'conversion.thank-you')!;
  const buy = BUILTIN_SMART_EVENTS.find((r) => r.id === 'cta.buy')!;

  it('matches a thank-you path in several languages', () => {
    expect(markMatchesRule({ kind: 'pageview', path: '/thank-you' }, thankYou)).toBe(true);
    expect(markMatchesRule({ kind: 'pageview', path: '/gracias' }, thankYou)).toBe(true);
    expect(markMatchesRule({ kind: 'pageview', path: '/ありがとう' }, thankYou)).toBe(true);
  });

  it('does not match a click rule against a path-only mark', () => {
    expect(markMatchesRule({ kind: 'pageview', path: '/buy' }, buy)).toBe(false);
  });

  it('matches a buy click by label', () => {
    expect(markMatchesRule({ kind: 'click', label: 'Buy now' }, buy)).toBe(true);
  });
});

describe('matchingSmartEvent', () => {
  it('returns the first builtin rule that matches', () => {
    const rule = matchingSmartEvent({ kind: 'pageview', path: '/checkout' });
    expect(rule?.id).toBe('conversion.checkout');
  });

  it('returns null when nothing matches', () => {
    expect(matchingSmartEvent({ kind: 'pageview', path: '/about' })).toBeNull();
  });
});
