import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JoinCanvasClient from './JoinCanvasClient';

const mocks = vi.hoisted(() => ({
  authenticated: false,
  preview: vi.fn(),
  joinAsGuest: vi.fn(),
  joinWithAccount: vi.fn(),
  adoptIssuedSession: vi.fn(),
  fetchTenants: vi.fn(),
  selectTenant: vi.fn(),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    authReady: true,
    isAuthenticated: mocks.authenticated,
    user: mocks.authenticated ? { id: 'u1', email: 'ada@example.com', name: 'Ada' } : null,
    adoptIssuedSession: mocks.adoptIssuedSession,
    fetchTenants: mocks.fetchTenants,
    selectTenant: mocks.selectTenant,
  }),
}));

vi.mock('@/lib/builderforceApi', () => ({
  canvasJoinApi: {
    preview: mocks.preview,
    joinAsGuest: mocks.joinAsGuest,
    joinWithAccount: mocks.joinWithAccount,
  },
}));

const TOKEN = 'a'.repeat(64);

describe('taking a canvas invite link', () => {
  beforeEach(() => {
    mocks.authenticated = false;
    for (const fn of [mocks.preview, mocks.joinAsGuest, mocks.joinWithAccount, mocks.adoptIssuedSession, mocks.fetchTenants, mocks.selectTenant]) fn.mockReset();
    mocks.preview.mockResolvedValue({ title: 'Launch plan', role: 'editor' });
  });

  it('says what is being offered before anything is claimed', async () => {
    render(<JoinCanvasClient token={TOKEN} navigate={vi.fn()} />);
    await screen.findByText('canvasJoin.accessEditor');
    // Reading the page must never spend a use of the link.
    expect(mocks.joinAsGuest).not.toHaveBeenCalled();
    expect(mocks.joinWithAccount).not.toHaveBeenCalled();
  });

  it('leads with the option that costs nothing, and joins without an account', async () => {
    mocks.joinAsGuest.mockResolvedValue({
      sessionId: 'sess-1',
      tenantId: 7,
      title: 'Launch plan',
      role: 'editor',
      alreadyMember: false,
      token: 'web-token',
      user: { id: 'g1', email: 'guest-g1@guest.invalid', name: 'Guest', accountType: 'guest', accountTypeSelected: true, hasPassword: false },
    });
    const navigate = vi.fn();
    render(<JoinCanvasClient token={TOKEN} navigate={navigate} />);

    const join = await screen.findByRole('button', { name: 'canvasJoin.joinAsGuest' });
    join.click();

    await waitFor(() => expect(mocks.adoptIssuedSession).toHaveBeenCalledWith(
      'web-token',
      expect.objectContaining({ id: 'g1', accountType: 'guest' }),
      7,
    ));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/create/sess-1'));
  });

  it('offers signing in as an alternative, never as the price of entry', async () => {
    render(<JoinCanvasClient token={TOKEN} navigate={vi.fn()} />);
    const signIn = await screen.findByRole('link', { name: 'canvasJoin.signInInstead' });
    expect(signIn).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/create/join/${TOKEN}`)}`);
  });

  it('seats the account somebody already has, and selects the workspace the BOARD is in', async () => {
    mocks.authenticated = true;
    mocks.joinWithAccount.mockResolvedValue({ sessionId: 'sess-2', tenantId: 9, title: 'Launch plan', role: 'editor', alreadyMember: true });
    mocks.fetchTenants.mockResolvedValue([{ id: '3', name: 'Mine' }, { id: '9', name: 'Theirs' }]);
    const navigate = vi.fn();
    render(<JoinCanvasClient token={TOKEN} navigate={navigate} />);

    const join = await screen.findByRole('button', { name: /canvasJoin\.joinAsMember/ });
    join.click();

    await waitFor(() => expect(mocks.selectTenant).toHaveBeenCalledWith({ id: '9', name: 'Theirs' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/create/sess-2'));
    // Nothing was minted for somebody who already has an identity.
    expect(mocks.adoptIssuedSession).not.toHaveBeenCalled();
  });

  it('reports a dead link instead of offering a join that cannot work', async () => {
    mocks.preview.mockRejectedValue(new Error('This invitation link is invalid, expired, or has been revoked'));
    render(<JoinCanvasClient token={TOKEN} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'canvasJoin.joinAsGuest' })).toBeNull());
  });
});
