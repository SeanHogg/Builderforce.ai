/**
 * @vitest-environment jsdom
 *
 * The visit counters live in localStorage, so this one needs a browser: the
 * `lib` project runs in node, where `window` is not defined.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({ apiRequestStream: vi.fn(async () => undefined) }));
vi.mock('./visitor', () => ({ getVisitorId: () => 'visitor-1' }));

const { beginVisit, getVisitId } = await import('./visitorJourney');

const VISIT_KEY = 'bf_visit_id';
const VISIT_SEEN_KEY = 'bf_visit_last_seen';
const VISIT_COUNT_KEY = 'bf_visit_count';
const IDLE_MS = 30 * 60 * 1000;

/** A visitor who was last here `agoMs` ago, on their `count`-th visit. */
function priorVisit(count: number, agoMs: number) {
  window.localStorage.setItem(VISIT_KEY, 'visit-earlier');
  window.localStorage.setItem(VISIT_COUNT_KEY, String(count));
  window.localStorage.setItem(VISIT_SEEN_KEY, String(Date.now() - agoMs));
}

describe('beginVisit', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reports the first-ever visit as visit 1, not returning', () => {
    expect(beginVisit()).toMatchObject({ visitNumber: 1, returning: false });
  });

  it('reports the SECOND visit as returning', () => {
    // The regression this exists for: the counters used to be read before the
    // visit was minted, so a second visit saw a stored count of 1, evaluated
    // `1 > 1`, and recorded the one visitor who definitely came back as new.
    priorVisit(1, IDLE_MS + 1000);
    expect(beginVisit()).toMatchObject({ visitNumber: 2, returning: true });
  });

  it('counts a later visit in order', () => {
    priorVisit(4, IDLE_MS + 1000);
    expect(beginVisit()).toMatchObject({ visitNumber: 5, returning: true });
  });

  it('does not open a second visit inside the idle window', () => {
    priorVisit(2, 60 * 1000);
    const visit = beginVisit();
    expect(visit.visitId).toBe('visit-earlier');
    expect(visit.visitNumber).toBe(2);
  });

  it('mints a visit id that later reads agree with', () => {
    const { visitId } = beginVisit();
    expect(visitId).toBeTruthy();
    expect(getVisitId()).toBe(visitId);
  });
});
