import { useEffect, useRef } from 'react';
import type { useBrainChats } from '@/lib/brain';

/**
 * A Brain docked to ONE project (Studio, the IDE) opens on that project's own
 * conversation.
 *
 * The docked panel shares its selection with the floating drawer, and that
 * selection survives navigation in session storage — so opening a project used to
 * restore whatever chat the tab last had open, from any project. The panel then
 * showed a foreign thread, or (when that chat's messages did not belong here) an
 * empty one, over a project whose build conversation was one click away in History.
 *
 * Once per mount, when the project's chats have loaded: a selection that is not one
 * of this project's chats gives way to the most recent one (or to none, for a new
 * project). An explicit entry — a `?chat=` deep link, a ticket to link, a prompt to
 * send — owns the selection and is left alone.
 */
export function usePinnedProjectChat({ chats, enabled }: {
  chats: ReturnType<typeof useBrainChats>;
  /** Docked, pinned to a project, and opened without an explicit chat, ticket or prompt. */
  enabled: boolean;
}) {
  const settledRef = useRef(false);
  const { loading, chats: list, activeChatId, select } = chats;

  useEffect(() => {
    if (!enabled || settledRef.current || loading) return;
    settledRef.current = true;
    if (activeChatId != null && list.some((chat) => chat.id === activeChatId)) return;
    void select(list[0]?.id ?? null);
  }, [enabled, loading, list, activeChatId, select]);
}
