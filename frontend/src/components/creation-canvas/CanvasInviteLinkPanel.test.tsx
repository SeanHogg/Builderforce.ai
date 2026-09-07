import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasInviteLinkPanel } from './CanvasInviteLinkPanel';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@/lib/builderforceApi', () => ({
  creationSessionsApi: { inviteLinks: { list: mocks.list, create: mocks.create, revoke: mocks.revoke } },
}));

vi.mock('@/lib/canvasHost', () => ({ canvasWebOrigin: () => 'https://builderforce.ai' }));

describe('inviting to a saved canvas by link', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.create.mockReset();
    mocks.revoke.mockReset();
    mocks.list.mockResolvedValue({ links: [] });
  });

  it('renders nothing for anybody but the owner, and asks the API nothing', () => {
    // Minting a link gives access away to whoever it is forwarded to. The gate lives in
    // the component so a second surface cannot mount it for the wrong person.
    for (const role of ['viewer', 'commenter', 'editor', 'runner'] as const) {
      const { container, unmount } = render(<CanvasInviteLinkPanel sessionId="s1" role={role} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('shows the URL of a freshly minted link, prefixed with the canvas origin', async () => {
    mocks.create.mockResolvedValue({
      id: 'l1', role: 'editor', token: 'b'.repeat(64), joinPath: `/create/join/${'b'.repeat(64)}`,
      expiresAt: null, maxUses: null, useCount: 0, lastUsedAt: null, createdAt: '2026-09-07T00:00:00.000Z',
    });
    render(<CanvasInviteLinkPanel sessionId="s1" role="owner" />);

    const create = await screen.findByRole('button', { name: 'creationCanvas.inviteLinkCreate' });
    create.click();

    const field = await screen.findByLabelText('creationCanvas.inviteLinkAriaLabel');
    await waitFor(() => expect(field).toHaveValue(`https://builderforce.ai/create/join/${'b'.repeat(64)}`));
    // The token is shown once and only once, so the note that says so must be there too.
    expect(screen.getByText('creationCanvas.inviteLinkCopyNow')).toBeInTheDocument();
  });

  it('mints the role the owner chose, not a default', async () => {
    mocks.create.mockResolvedValue({
      id: 'l2', role: 'viewer', token: 'c'.repeat(64), joinPath: `/create/join/${'c'.repeat(64)}`,
      expiresAt: null, maxUses: null, useCount: 0, lastUsedAt: null, createdAt: '2026-09-07T00:00:00.000Z',
    });
    render(<CanvasInviteLinkPanel sessionId="s1" role="owner" />);

    const select = await screen.findByLabelText<HTMLSelectElement>('creationCanvas.inviteLinkRole');
    // Only the three roles a URL may carry are offerable — `runner` spends tokens and
    // `owner` gives the board away.
    expect([...select.options].map((option) => option.value)).toEqual(['viewer', 'commenter', 'editor']);

    select.value = 'viewer';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    screen.getByRole('button', { name: 'creationCanvas.inviteLinkCreate' }).click();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('s1', { role: 'viewer' }));
  });

  it('lists live links by what they grant, and revokes one', async () => {
    mocks.list.mockResolvedValue({
      links: [{ id: 'l3', role: 'commenter', expiresAt: null, maxUses: null, useCount: 2, lastUsedAt: null, createdAt: '2026-09-07T00:00:00.000Z' }],
    });
    mocks.revoke.mockResolvedValue(undefined);
    render(<CanvasInviteLinkPanel sessionId="s1" role="owner" />);

    const revoke = await screen.findByRole('button', { name: 'creationCanvas.inviteLinkRevoke' });
    revoke.click();
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('s1', 'l3'));
  });
});
