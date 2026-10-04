import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ctx: { setActiveChatId: vi.fn(), setContext: vi.fn(), setOpen: vi.fn() },
  getTeamChat: vi.fn(),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/brain', () => ({ useOptionalBrainContext: () => mocks.ctx }));
vi.mock('@/lib/builderforceApi', () => ({ brain: { getTeamChat: mocks.getTeamChat } }));

import { DockedBrainProvider } from '@/lib/brain/dockedBrain';
import { TeamChatButton } from './TeamChatButton';

beforeEach(() => {
  for (const fn of Object.values(mocks.ctx)) fn.mockReset();
  mocks.getTeamChat.mockReset().mockResolvedValue({ id: 42 });
});

describe('TeamChatButton', () => {
  it('opens the floating drawer on a surface with no docked Brain', async () => {
    render(<TeamChatButton projectId={7} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.ctx.setOpen).toHaveBeenCalledWith(true));
    expect(mocks.ctx.setActiveChatId).toHaveBeenCalledWith(42);
    expect(mocks.getTeamChat).toHaveBeenCalledWith({ projectId: 7, teamId: null });
  });

  it('selects the chat in the docked Brain instead of opening a second panel', async () => {
    const reveal = vi.fn();
    render(<DockedBrainProvider reveal={reveal}><TeamChatButton projectId={7} /></DockedBrainProvider>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(reveal).toHaveBeenCalled());
    expect(mocks.ctx.setActiveChatId).toHaveBeenCalledWith(42);
    expect(mocks.ctx.setOpen).not.toHaveBeenCalled();
  });
});
