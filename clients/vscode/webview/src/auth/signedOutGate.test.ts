import { describe, expect, it } from 'vitest';
import { needsRouteBanner, rootGate } from './signedOutGate';

describe('rootGate — signed out is never a wall', () => {
  it('renders the surface when signed out, with or without a local route', () => {
    expect(rootGate({ signedIn: false, hasToken: false, localRoute: false, tokenFailed: false })).toBe('ready');
    expect(rootGate({ signedIn: false, hasToken: false, localRoute: true, tokenFailed: false })).toBe('ready');
  });
  it('waits for the token only when signed in without one', () => {
    expect(rootGate({ signedIn: true, hasToken: false, localRoute: false, tokenFailed: false })).toBe('connecting');
    expect(rootGate({ signedIn: true, hasToken: false, localRoute: false, tokenFailed: true })).toBe('connect-failed');
    expect(rootGate({ signedIn: true, hasToken: true, localRoute: false, tokenFailed: false })).toBe('ready');
    expect(rootGate({ signedIn: true, hasToken: false, localRoute: true, tokenFailed: false })).toBe('ready');
  });
});

describe('needsRouteBanner', () => {
  it('shows only when signed out with no local route and no local models', () => {
    expect(needsRouteBanner({ signedIn: false, localRoute: false, localModelCount: 0 })).toBe(true);
    expect(needsRouteBanner({ signedIn: false, localRoute: false, localModelCount: 2 })).toBe(false);
    expect(needsRouteBanner({ signedIn: false, localRoute: true, localModelCount: 0 })).toBe(false);
    expect(needsRouteBanner({ signedIn: true, localRoute: false, localModelCount: 0 })).toBe(false);
  });
});
