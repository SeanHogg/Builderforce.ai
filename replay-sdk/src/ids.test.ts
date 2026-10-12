import { afterEach, describe, expect, it } from 'vitest';
import { VISIT_IDLE_MS, VISITOR_ID_PATTERN } from '@builderforce/interaction-contract';
import { getVisitId, getVisitorId, mintId } from './ids';

afterEach(() => {
  window.localStorage.clear();
  document.cookie.split(';').forEach((part) => {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  });
});

describe('mintId', () => {
  it('matches the ingest guard (8–64 url-safe chars)', () => {
    for (let i = 0; i < 20; i++) {
      expect(mintId()).toMatch(VISITOR_ID_PATTERN);
    }
  });
});

describe('getVisitorId', () => {
  it('is stable across calls and persisted', () => {
    const a = getVisitorId();
    const b = getVisitorId();
    expect(a).toBe(b);
    expect(a).toMatch(VISITOR_ID_PATTERN);
    expect(window.localStorage.getItem('bf_visitor_id')).toBe(a);
  });
});

describe('getVisitId', () => {
  it('reuses the visit inside the idle window and rotates after it', () => {
    const t0 = 1_700_000_000_000;
    const first = getVisitId(t0);
    expect(first).toMatch(VISITOR_ID_PATTERN);
    // Inside the window: same visit — and the call itself refreshes "last seen",
    // because the window is an idle GAP, not a fixed span from the first call.
    const seen = t0 + VISIT_IDLE_MS;
    expect(getVisitId(seen)).toBe(first);
    // A gap just past the window since that last activity starts a new visit.
    const next = getVisitId(seen + VISIT_IDLE_MS + 1);
    expect(next).not.toBe(first);
    expect(next).toMatch(VISITOR_ID_PATTERN);
  });
});
