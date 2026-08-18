import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InvitationAcceptClient from './InvitationAcceptClient';

const mocks = vi.hoisted(() => ({
  authenticated: false,
  accept: vi.fn(),
  fetchTenants: vi.fn(),
  selectTenant: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    // The component waits for the stored session to have been read before it
    // decides anything; a mock that omits this holds it on "please sign in".
    authReady: true,
    isAuthenticated: mocks.authenticated,
    fetchTenants: mocks.fetchTenants,
    selectTenant: mocks.selectTenant,
    logout: mocks.logout,
  }),
}));

vi.mock('@/lib/builderforceApi', () => ({
  creationSessionsApi: { invitations: { acceptWithAccount: mocks.accept } },
}));

const TOKEN = 'a'.repeat(64);

describe('Creation Session invitation acceptance', () => {
  beforeEach(() => {
    mocks.authenticated = false;
    mocks.accept.mockReset();
    mocks.fetchTenants.mockReset();
    mocks.selectTenant.mockReset();
    mocks.logout.mockReset();
  });

  it('lets a signed-in recipient switch when the wrong account is active', async () => {
    mocks.authenticated = true;
    mocks.accept.mockRejectedValue(new Error('Sign in with the email address that received this invitation'));
    const navigate = vi.fn();
    render(<InvitationAcceptClient token={TOKEN} navigate={navigate} />);

    const switchAccount = await screen.findByRole('button', { name: 'creationInvitation.useAnotherAccount' });
    switchAccount.click();
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/create/invitations/${TOKEN}`)}`);
  });

  it('preserves the invitation while a signed-out recipient authenticates', () => {
    render(<InvitationAcceptClient token={TOKEN} />);
    expect(screen.getByRole('link', { name: 'creationInvitation.signInLink' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(`/create/invitations/${TOKEN}`)}`,
    );
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it('accepts with the account token, switches workspace, and opens the Session', async () => {
    mocks.authenticated = true;
    mocks.accept.mockResolvedValue({ sessionId: 'session-1', tenantId: 42, role: 'editor' });
    mocks.fetchTenants.mockResolvedValue([{ id: '7', name: 'Current' }, { id: '42', name: 'Invited' }]);
    mocks.selectTenant.mockResolvedValue(undefined);
    const navigate = vi.fn();

    render(<InvitationAcceptClient token={TOKEN} navigate={navigate} />);

    await waitFor(() => expect(mocks.selectTenant).toHaveBeenCalledWith({ id: '42', name: 'Invited' }));
    expect(mocks.accept).toHaveBeenCalledWith(TOKEN);
    expect(navigate).toHaveBeenCalledWith('/create/session-1');
  });
});
