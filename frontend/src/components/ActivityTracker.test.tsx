import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { flushActivity, trackActivity } from '@/lib/activity/tracker';
import { legacyCreationHref } from '@/lib/canvas/legacyCreationRoute';
import ActivityTracker from './ActivityTracker';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ authReady: true, isAuthenticated: true }) }));
vi.mock('@/lib/activity/tracker', () => ({
  trackActivity: vi.fn(),
  flushActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

it('records an adapted landing once and removes only the route marker', () => {
  const target = '/create/board?focus=card#anchor';
  window.history.replaceState(null, '', legacyCreationHref(target, '/workflows/builder'));
  const { unmount } = render(<ActivityTracker />);
  expect(trackActivity).toHaveBeenCalledWith('creation_legacy_route_adapted', { ref: '/workflows/builder' });
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(target);

  unmount();
  expect(flushActivity).toHaveBeenCalled();
  render(<ActivityTracker />);
  expect(vi.mocked(trackActivity).mock.calls.filter(([kind]) => kind === 'creation_legacy_route_adapted')).toHaveLength(1);
});
