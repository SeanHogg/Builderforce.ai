import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useChatRowActions, type ChatRowRef } from '@seanhogg/builderforce-brain-ui';
import { useConfirm } from '@/components/ConfirmProvider';
import type { useBrainChats } from '@/lib/brain';

/**
 * The web Brain panel's binding of THE shared chat-history row state
 * (`useChatRowActions`): the panel's chat hook as the actions, the web's confirm
 * dialog worded through next-intl, and the open behaviour of each layout.
 *
 * Held at panel level rather than inside the list: docked, the list is a tab that
 * unmounts while the conversation is shown.
 */
export function useBrainChatRowActions({ chats, isPage, showChatTab }: {
  chats: ReturnType<typeof useBrainChats>;
  isPage: boolean;
  /** Docked: bring the conversation tab forward. */
  showChatTab: () => void;
}) {
  const tBrain = useTranslations('brain');
  const confirm = useConfirm();
  const { select, rename, summarize, remove, assignToProject } = chats;

  /**
   * Docked, history is a tab beside the conversation, so opening a chat switches back
   * to it; the page keeps the list permanently beside the thread and instead reveals
   * that row's actions (`revealActionsOnOpen`).
   */
  const onOpen = useCallback((id: number) => {
    void select(id);
    if (!isPage) showChatTab();
  }, [select, isPage, showChatTab]);

  const confirmDelete = useCallback(
    (chat: ChatRowRef) => confirm(tBrain('deleteChatConfirm', { title: chat.title?.trim() || tBrain('thisChat') })),
    [confirm, tBrain],
  );

  return useChatRowActions({
    onOpen,
    revealActionsOnOpen: isPage,
    rename,
    summarize,
    remove: (chat) => remove(chat.id),
    confirmDelete,
    assign: assignToProject,
  });
}
