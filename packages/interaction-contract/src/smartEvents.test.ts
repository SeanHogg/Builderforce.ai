import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SMART_EVENTS,
  BUILTIN_SMART_EVENT_NAMES,
  GOAL_SMART_EVENTS,
  markMatchesRule,
  smartEventsForMark,
  type SmartEventRule,
} from './smartEvents';

describe('BUILTIN_SMART_EVENTS', () => {
  it('covers every built-in name with at least one rule', () => {
    for (const name of BUILTIN_SMART_EVENT_NAMES) {
      expect(BUILTIN_SMART_EVENTS.some((rule) => rule.name === name)).toBe(true);
    }
  });

  it('goal events are built-in names', () => {
    for (const name of GOAL_SMART_EVENTS) expect(BUILTIN_SMART_EVENT_NAMES).toContain(name);
  });
});

describe('markMatchesRule', () => {
  const page = (match: string, matchMode: SmartEventRule['matchMode']): SmartEventRule => ({ name: 'x', ruleKind: 'page', match, matchMode });

  it('honours equals / prefix / contains, case-insensitively', () => {
    expect(markMatchesRule({ kind: 'page', key: '/Pricing' }, page('/pricing', 'equals'))).toBe(true);
    expect(markMatchesRule({ kind: 'page', key: '/pricing/team' }, page('/pricing', 'equals'))).toBe(false);
    expect(markMatchesRule({ kind: 'page', key: '/pricing/team' }, page('/pricing', 'prefix'))).toBe(true);
    expect(markMatchesRule({ kind: 'page', key: '/a/pricing' }, page('/pricing', 'prefix'))).toBe(false);
    expect(markMatchesRule({ kind: 'page', key: '/a/pricing' }, page('pricing', 'contains'))).toBe(true);
  });

  it('matches a rule only against its mark kind', () => {
    const custom: SmartEventRule = { name: 'trial', ruleKind: 'custom', match: 'trial_started', matchMode: 'equals' };
    expect(markMatchesRule({ kind: 'event', key: 'trial_started' }, custom)).toBe(true);
    expect(markMatchesRule({ kind: 'page', key: 'trial_started' }, custom)).toBe(false);
    expect(markMatchesRule({ kind: 'rage', key: 'x', label: 'Sign up' }, BUILTIN_SMART_EVENTS[0]!)).toBe(false);
  });
});

describe('smartEventsForMark', () => {
  it('names sign-up clicks in five languages', () => {
    for (const label of ['Sign up free', '立即注册', 'Regístrate', "S'inscrire", 'Jetzt registrieren']) {
      expect(smartEventsForMark({ kind: 'click', key: 's', label })).toContain('sign up');
    }
  });

  it('names contact and download from the link target', () => {
    expect(smartEventsForMark({ kind: 'click', key: 's', href: 'mailto:' })).toEqual(['contact']);
    expect(smartEventsForMark({ kind: 'click', key: 's', href: '/files/brochure.pdf' })).toEqual(['download']);
  });

  it('names checkout and purchase pages', () => {
    expect(smartEventsForMark({ kind: 'page', key: '/checkout/shipping' })).toEqual(['begin checkout']);
    expect(smartEventsForMark({ kind: 'page', key: '/order-confirmation' })).toEqual(['purchase']);
  });

  it('is empty for an ordinary mark', () => {
    expect(smartEventsForMark({ kind: 'page', key: '/about' })).toEqual([]);
    expect(smartEventsForMark({ kind: 'click', key: 's', label: 'Read more' })).toEqual([]);
  });

  it('accepts a site rule set', () => {
    const rules: SmartEventRule[] = [{ name: 'demo', ruleKind: 'click', match: 'book a demo', matchMode: 'contains' }];
    expect(smartEventsForMark({ kind: 'click', key: 's', label: 'Book a demo today' }, rules)).toEqual(['demo']);
  });
});
