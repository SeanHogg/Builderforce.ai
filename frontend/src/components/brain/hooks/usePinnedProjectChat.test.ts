import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePinnedProjectChat } from './usePinnedProjectChat';
import type { useBrainChats } from '@/lib/brain';

type Chats = ReturnType<typeof useBrainChats>;

function chatsWith({ loading = false, ids = [] as number[], activeChatId = null as number | null }) {
  const select = vi.fn(async () => null);
  const chats = { loading, chats: ids.map((id) => ({ id })), activeChatId, select } as unknown as Chats;
  return { chats, select };
}

describe('usePinnedProjectChat', () => {
  // The bug: the docked panel restored the tab's last chat from ANOTHER project and
  // showed it (or nothing) over a project whose own conversation was in History.
  it('replaces a selection from another project with this project\'s latest chat', () => {
    const { chats, select } = chatsWith({ ids: [42, 41], activeChatId: 7 });
    renderHook(() => usePinnedProjectChat({ chats, enabled: true }));
    expect(select).toHaveBeenCalledWith(42);
  });

  it('opens the latest chat when nothing is selected', () => {
    const { chats, select } = chatsWith({ ids: [42, 41] });
    renderHook(() => usePinnedProjectChat({ chats, enabled: true }));
    expect(select).toHaveBeenCalledWith(42);
  });

  it('keeps a selection that already belongs to this project', () => {
    const { chats, select } = chatsWith({ ids: [42, 41], activeChatId: 41 });
    renderHook(() => usePinnedProjectChat({ chats, enabled: true }));
    expect(select).not.toHaveBeenCalled();
  });

  it('clears a foreign selection on a project with no chats yet', () => {
    const { chats, select } = chatsWith({ ids: [], activeChatId: 7 });
    renderHook(() => usePinnedProjectChat({ chats, enabled: true }));
    expect(select).toHaveBeenCalledWith(null);
  });

  it('waits for the chats to load, then settles once', () => {
    const loading = chatsWith({ loading: true, ids: [], activeChatId: 7 });
    const { rerender } = renderHook(({ chats }) => usePinnedProjectChat({ chats, enabled: true }), { initialProps: { chats: loading.chats } });
    expect(loading.select).not.toHaveBeenCalled();

    const loaded = chatsWith({ ids: [42], activeChatId: 7 });
    rerender({ chats: loaded.chats });
    expect(loaded.select).toHaveBeenCalledTimes(1);

    // A later change of selection (the person opens another chat) is theirs.
    const later = chatsWith({ ids: [42], activeChatId: 99 });
    rerender({ chats: later.chats });
    expect(later.select).not.toHaveBeenCalled();
  });

  // A deep link, a ticket or a prompt owns the selection.
  it('does nothing when disabled', () => {
    const { chats, select } = chatsWith({ ids: [42], activeChatId: 7 });
    renderHook(() => usePinnedProjectChat({ chats, enabled: false }));
    expect(select).not.toHaveBeenCalled();
  });
});
