// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestAccountPrompt } from './GuestAccountPrompt';
import { noteSignedOutRead, resetGuestWall } from '@/domains/guest/application/guestWall';
import en from '@/i18n/messages/en.json';

const mocks = vi.hoisted(() => ({ signedIn: false, ready: true }));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    authReady: mocks.ready,
    isAuthenticated: mocks.signedIn,
    hasTenant: mocks.signedIn,
  }),
}));

// The global next/navigation mock answers `usePathname()` with '/'; the wall is
// recorded from `window.location`, so the two agree when the test puts the
// visitor on '/'.
function meetWallOn(pathname: string) {
  window.history.replaceState(null, '', pathname);
  noteSignedOutRead();
}

beforeEach(() => {
  resetGuestWall();
  mocks.signedIn = false;
  mocks.ready = true;
  window.history.replaceState(null, '', '/');
});

describe('GuestAccountPrompt', () => {
  it('renders nothing until a read on this route has been refused', () => {
    const { container } = render(<GuestAccountPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('invites a guest in where the refused content would have been, carrying them back here', () => {
    meetWallOn('/');
    render(<GuestAccountPrompt />);

    expect(screen.getByText('guest.wall.title')).toBeTruthy();
    expect(screen.getByText('guest.wall.body')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'common.createFreeAccount' }).getAttribute('href'))
      .toBe('/register?next=%2F');
    expect(screen.getByRole('link', { name: 'common.signIn' }).getAttribute('href'))
      .toBe('/login?next=%2F');
  });

  it('never shows a signed-in person the invitation, whatever the wall says', () => {
    mocks.signedIn = true;
    meetWallOn('/');
    const { container } = render(<GuestAccountPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('waits for the session to have been read rather than flashing at a signed-in visitor', () => {
    mocks.ready = false;
    meetWallOn('/');
    const { container } = render(<GuestAccountPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('stays down on a route other than the one the wall was met on', () => {
    meetWallOn('/investor');
    const { container } = render(<GuestAccountPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a visitor ONE invitation: the shell copy stands down while an inline one is up', () => {
    meetWallOn('/');
    const { container, unmount } = render(
      <>
        <GuestAccountPrompt placement="shell" />
        <GuestAccountPrompt />
      </>,
    );
    const shown = container.querySelectorAll('[data-guest-wall]');
    expect(shown.length).toBe(1);
    expect(shown[0].getAttribute('data-guest-wall')).toBe('inline');
    unmount();

    render(<GuestAccountPrompt placement="shell" />);
    expect(document.querySelectorAll('[data-guest-wall="shell"]').length).toBe(1);
  });

  it('says what an account unlocks, in every catalogue', () => {
    expect(en.guest.wall.title).toMatch(/account/i);
    expect(en.guest.wall.body).toMatch(/free account/i);
  });
});
