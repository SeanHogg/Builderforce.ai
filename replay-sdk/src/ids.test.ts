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
    expect(getVisitId(t0 + VISIT_IDLE_MS)).toBe(first);
    const next = getVisitId(t0 + VISIT_IDLE_MS + 1);
    expect(next).not.toBe(first);
    expect(next).toMatch(VISITOR_ID_PATTERN);
  });
});
