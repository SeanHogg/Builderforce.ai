// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('stands the catch-all in the CENTRE, not in whatever corner a full-screen surface left free', () => {
    meetWallOn('/');
    const { container } = render(<GuestAccountPrompt placement="shell" />);

    // It portals out of the page: a canvas's stacking context / overflow cannot
    // corner or clip it.
    expect(container.querySelector('[data-guest-wall="shell"]')).toBeNull();
    const overlay = document.querySelector('[data-guest-wall-overlay="shell"]');
    expect(overlay).toBeTruthy();
    expect(overlay?.classList.contains('modal-overlay')).toBe(true);
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.querySelector('[data-guest-wall="shell"]')).toBeTruthy();
  });

  it('leaves the inline invitation in flow, where the rows would have been', () => {
    meetWallOn('/');
    const { container } = render(<GuestAccountPrompt />);
    expect(container.querySelector('[data-guest-wall="inline"]')).toBeTruthy();
    expect(document.querySelector('[data-guest-wall-overlay="shell"]')).toBeNull();
  });

  it('lets a guest close the modal and keep exploring — and stays closed on that route', () => {
    meetWallOn('/');
    const { rerender } = render(<GuestAccountPrompt placement="shell" />);

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(document.querySelector('[data-guest-wall-overlay="shell"]')).toBeNull();

    // The canvas fires several reads; the next refusal on the same route must not
    // put the modal straight back up.
    noteSignedOutRead();
    rerender(<GuestAccountPrompt placement="shell" />);
    expect(document.querySelector('[data-guest-wall-overlay="shell"]')).toBeNull();
  });

  it('escape closes it, so a visitor is never trapped behind the invitation', () => {
    meetWallOn('/');
    render(<GuestAccountPrompt placement="shell" />);
    expect(document.querySelector('[data-guest-wall-overlay="shell"]')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('[data-guest-wall-overlay="shell"]')).toBeNull();
  });

  it('says what an account unlocks, in every catalogue', () => {
    expect(en.guest.wall.title).toMatch(/account/i);
    expect(en.guest.wall.body).toMatch(/free account/i);
  });
});
