import { describe, expect, it } from 'vitest';
import {
  BROADCAST_MAX_VISITOR_IDS,
  EVERYONE,
  audienceMatches,
  parseBroadcastAudience,
  type VisitorStanding,
} from './BroadcastAudience';

const visitor = (over: Partial<VisitorStanding> = {}): VisitorStanding => ({
  visitorId: 'v1',
  registered: false,
  paid: false,
  promptCount: 0,
  ...over,
});

describe('parseBroadcastAudience', () => {
  it('reads a well-formed rule back verbatim', () => {
    expect(parseBroadcastAudience({ scope: 'paid', visitorIds: ['a', 'b'], minPrompts: 3 }))
      .toEqual({ scope: 'paid', visitorIds: ['a', 'b'], minPrompts: 3 });
  });

  it('fails OPEN on anything unrecognised rather than silently reaching nobody', () => {
    for (const bad of [null, undefined, 'all', 42, { scope: 'vip' }]) {
      expect(parseBroadcastAudience(bad)).toEqual(EVERYONE);
    }
  });

  it('caps the explicit visitor list — it becomes an IN (…) on a hot query', () => {
    const many = Array.from({ length: BROADCAST_MAX_VISITOR_IDS + 50 }, (_, i) => `v${i}`);
    expect(parseBroadcastAudience({ visitorIds: many }).visitorIds).toHaveLength(BROADCAST_MAX_VISITOR_IDS);
  });

  it('drops non-string and blank visitor ids instead of storing them', () => {
    expect(parseBroadcastAudience({ visitorIds: ['a', '', '  ', 7, null, ' b '] }).visitorIds)
      .toEqual(['a', 'b']);
  });

  it('floors a fractional or negative minPrompts to a whole non-negative count', () => {
    expect(parseBroadcastAudience({ minPrompts: 2.7 }).minPrompts).toBe(2);
    expect(parseBroadcastAudience({ minPrompts: -5 }).minPrompts).toBe(0);
    expect(parseBroadcastAudience({ minPrompts: Number.NaN }).minPrompts).toBe(0);
  });
});

describe('audienceMatches', () => {
  it('reaches everyone by default', () => {
    expect(audienceMatches(EVERYONE, visitor())).toBe(true);
    expect(audienceMatches(EVERYONE, visitor({ registered: true, paid: true }))).toBe(true);
  });

  it('separates the funnel stages', () => {
    const anon = visitor();
    const signedUp = visitor({ registered: true });
    const paying = visitor({ registered: true, paid: true });

    const guest = parseBroadcastAudience({ scope: 'guest' });
    expect(audienceMatches(guest, anon)).toBe(true);
    expect(audienceMatches(guest, signedUp)).toBe(false);

    const registered = parseBroadcastAudience({ scope: 'registered' });
    expect(audienceMatches(registered, anon)).toBe(false);
    expect(audienceMatches(registered, signedUp)).toBe(true);

    const paid = parseBroadcastAudience({ scope: 'paid' });
    expect(audienceMatches(paid, signedUp)).toBe(false);
    expect(audienceMatches(paid, paying)).toBe(true);
  });

  it('an explicit visitor list excludes every visitor not on it', () => {
    const only = parseBroadcastAudience({ visitorIds: ['v2'] });
    expect(audienceMatches(only, visitor({ visitorId: 'v1' }))).toBe(false);
    expect(audienceMatches(only, visitor({ visitorId: 'v2' }))).toBe(true);
  });

  it('engagement and funnel stage both have to hold, not either', () => {
    const engagedGuests = parseBroadcastAudience({ scope: 'guest', minPrompts: 2 });
    expect(audienceMatches(engagedGuests, visitor({ promptCount: 1 }))).toBe(false);
    expect(audienceMatches(engagedGuests, visitor({ promptCount: 2 }))).toBe(true);
    expect(audienceMatches(engagedGuests, visitor({ promptCount: 5, registered: true }))).toBe(false);
  });
});
