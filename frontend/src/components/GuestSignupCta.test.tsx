import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuestSignupCta } from './GuestSignupCta';
import { guestLimitFromBody, guestLimitRefusal, noteGuestLimit, onGuestLimit } from '@/lib/guestLimit';
import en from '@/i18n/messages/en.json';

// The global next-intl mock returns the KEY, not the copy (see src/test/setup.ts),
// so wiring is asserted by key and the copy itself against the catalogue below.

/** The gateway's refusal for a guest who has spent an allowance. */
function refusedTurn(body: Record<string, unknown>) {
  return Object.assign(new Error('You have used your 10 free guest messages for today.'), {
    status: 429,
    code: String(body.code ?? ''),
    body,
  });
}

describe('guestLimitRefusal', () => {
  it('reads the allowance, its scope and its cap off a refused turn', () => {
    expect(guestLimitRefusal(refusedTurn({ code: 'guest_limit_reached', reason: 'guest', limit: 10 })))
      .toEqual({ allowance: 'messages', reason: 'guest', limit: 10 });
    expect(guestLimitRefusal(refusedTurn({ code: 'guest_limit_reached', reason: 'ip', limit: 30 })))
      .toEqual({ allowance: 'messages', reason: 'ip', limit: 30 });
    expect(guestLimitRefusal(refusedTurn({ code: 'guest_limit_reached', reason: 'room', limit: 10 })))
      .toEqual({ allowance: 'messages', reason: 'room', limit: 10 });
  });

  it('recognises the research allowance, which is refused as a tool RESULT', () => {
    expect(guestLimitFromBody({ code: 'guest_research_limit_reached', reason: 'guest', limit: 40 }))
      .toEqual({ allowance: 'research', reason: 'guest', limit: 40 });
  });

  it('degrades to the visitor scope when the body names nothing usable', () => {
    expect(guestLimitRefusal(refusedTurn({ code: 'guest_limit_reached' })))
      .toEqual({ allowance: 'messages', reason: 'guest', limit: null });
  });

  it('is not tripped by any other failure', () => {
    expect(guestLimitRefusal(new Error('Model timed out'))).toBeNull();
    expect(guestLimitRefusal(refusedTurn({ code: 'plan_required', requiredPlan: 'pro' }))).toBeNull();
    expect(guestLimitRefusal(null)).toBeNull();
    expect(guestLimitFromBody({})).toBeNull();
  });

  it('carries a wall met inside a turn to whoever is listening, and stops on unsubscribe', () => {
    const seen = vi.fn();
    const stop = onGuestLimit(seen);
    const refusal = { allowance: 'research', reason: 'guest', limit: 40 } as const;

    noteGuestLimit(refusal);
    expect(seen).toHaveBeenCalledWith(refusal);

    stop();
    noteGuestLimit(refusal);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('GuestSignupCta', () => {
  it('renders nothing when nothing is blocked, so a host can mount it unconditionally', () => {
    const { container } = render(<GuestSignupCta prompt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers both ways in, each carrying the visitor back to where they were', () => {
    render(<GuestSignupCta prompt={{ next: '/create/local-1' }} />);

    expect(screen.getByRole('link', { name: 'common.createFreeAccount' }).getAttribute('href'))
      .toBe('/register?next=%2Fcreate%2Flocal-1');
    expect(screen.getByRole('link', { name: 'common.signIn' }).getAttribute('href'))
      .toBe('/login?next=%2Fcreate%2Flocal-1');
  });

  it('reports the sign-up click so the conversion is counted', () => {
    const onAccept = vi.fn();
    render(<GuestSignupCta prompt={{ next: '/brainstorm', onAccept }} />);

    screen.getByRole('link', { name: 'common.createFreeAccount' }).click();
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('says only what the surface gave it — the canvas transcript is its own statement', () => {
    const { container, rerender } = render(<GuestSignupCta prompt={{}} />);
    expect(screen.getByText('common.guestSignupTitle')).toBeTruthy();
    expect(container.querySelector('p')).toBeNull();

    rerender(<GuestSignupCta prompt={{}} title="You're on a roll!" body="Ten free messages, spent." />);
    expect(screen.getByText('Ten free messages, spent.')).toBeTruthy();
    expect(screen.queryByText('common.guestSignupTitle')).toBeNull();
  });

  it('drops to the button row alone for a surface with its own heading', () => {
    render(<GuestSignupCta prompt={{}} layout="actions" />);
    expect(screen.queryByText('common.guestSignupTitle')).toBeNull();
    expect(screen.getByRole('link', { name: 'common.createFreeAccount' })).toBeTruthy();
  });

  it('says it in words a blocked visitor can act on', () => {
    expect(en.common.guestSignupTitle).toBe("You're on a roll!");
    expect(en.common.createFreeAccount).toBe('Create a free account');
  });
});
