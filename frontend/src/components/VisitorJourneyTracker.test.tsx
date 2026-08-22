import { render, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The tracker exists to measure people who have NO account, and the two ways it
 * can get that wrong are symmetrical: record a signed-in employee's navigation
 * (double-counting what `activity_log` already holds), or stay silent for the
 * anonymous visitor it was built for.
 *
 * The interesting case is neither of those on their own — it is the moment
 * BETWEEN them. `isAuthenticated` is false until the stored session has been read
 * back, so a tracker that keys on it alone opens a visit for the signed-in user
 * during the first render and only then learns better. `authReady` is the fact
 * that distinguishes "anonymous" from "not known yet", and these tests pin it.
 */

const session = { authReady: true, isAuthenticated: false };

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => session,
}));

const pathname = { current: '/pricing' };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

const beginVisit = vi.fn(() => ({ visitId: 'visit-1', visitNumber: 2, returning: true }));
const queueVisitorEvent = vi.fn();
const trackVisitorEvent = vi.fn();
vi.mock('@/lib/visitorJourney', () => ({
  VISITOR_JOURNEY_KINDS: {
    visitStart: 'visit_start',
    pageView: 'page_view',
    error: 'error',
    visitEnd: 'visit_end',
  },
  queueVisitorEvent: (event: unknown) => queueVisitorEvent(event),
  trackVisitorEvent: (event: unknown) => trackVisitorEvent(event),
  flushVisitorEvents: vi.fn(),
  beginVisit: () => beginVisit(),
}));

const { VisitorJourneyTracker } = await import('./VisitorJourneyTracker');

const kinds = () => queueVisitorEvent.mock.calls.map(([event]) => event.kind);

describe('VisitorJourneyTracker', () => {
  beforeEach(() => {
    queueVisitorEvent.mockClear();
    trackVisitorEvent.mockClear();
    pathname.current = '/pricing';
    session.authReady = true;
    session.isAuthenticated = false;
  });

  it('opens the visit and records the page for an anonymous visitor', () => {
    render(<VisitorJourneyTracker />);
    expect(kinds()).toEqual(['visit_start', 'page_view']);
  });

  it('records nothing for a signed-in visitor', () => {
    session.isAuthenticated = true;
    render(<VisitorJourneyTracker />);
    expect(queueVisitorEvent).not.toHaveBeenCalled();
  });

  it('records nothing while the session is still unknown', () => {
    // The pre-rehydration frame: no session read yet, so `isAuthenticated` is
    // false for the signed-in user as much as for the anonymous one.
    session.authReady = false;
    render(<VisitorJourneyTracker />);
    expect(queueVisitorEvent).not.toHaveBeenCalled();
  });

  it('starts recording once a session that turns out to be anonymous is known', () => {
    session.authReady = false;
    const view = render(<VisitorJourneyTracker />);
    session.authReady = true;
    act(() => { view.rerender(<VisitorJourneyTracker />); });
    expect(kinds()).toEqual(['visit_start', 'page_view']);
  });

  it('counts one page view per distinct path, not per render', () => {
    const view = render(<VisitorJourneyTracker />);
    act(() => { view.rerender(<VisitorJourneyTracker />); });
    pathname.current = '/features';
    act(() => { view.rerender(<VisitorJourneyTracker />); });
    expect(kinds()).toEqual(['visit_start', 'page_view', 'page_view']);
  });
});
