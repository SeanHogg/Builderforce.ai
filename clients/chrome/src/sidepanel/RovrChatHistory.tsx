/**
 * Rovr's chat history — THE shared `ChatHistoryList` / `ChatHistoryRow` every AI surface
 * opens from its header's History lever, over the device record's chats. Rename writes
 * the device record (`updateChat`); there is no delete or summarize on the device record,
 * so the rows do not offer them.
 */
import { useMemo, useState } from 'react';
import { ChatHistoryList, ChatHistoryRow, type ChatHistoryChat, type ChatHistoryLabels } from '@seanhogg/builderforce-brain-ui';
import { t } from '../i18n/t';
import type { LocalChat } from '../store/records';
import { useServices } from './hooks';

export interface RovrChatHistoryProps {
  /** The element the header's History lever controls. */
  id: string;
  chats: LocalChat[];
  chatId: number | null;
  onOpen(chatId: number): void;
  onChanged(): void;
}

export function RovrChatHistory({ id, chats, chatId, onOpen, onChanged }: RovrChatHistoryProps) {
  const services = useServices();
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const labels = useMemo<Partial<ChatHistoryLabels>>(
    () => ({
      loading: t('loading'),
      empty: t('noChats'),
      noMatch: t('noChats'),
      actions: t('chatActions'),
      actionsAria: t('chatActionsFor', '{title}'),
      rename: t('chatRename'),
    }),
    [],
  );

  const submitRename = (chat: number, value: string) => {
    setRenaming(null);
    setActionsFor(null);
    const title = value.trim();
    if (!title || title === chats.find((c) => c.id === chat)?.title) return;
    void services.records.updateChat(chat, { title }).then(onChanged, (e: unknown) => services.reportError(e, 'chat.rename'));
  };

  return (
    <ChatHistoryList id={id} className="rovr-history" total={chats.length} labels={labels}>
      {chats.map((c) => (
        <ChatHistoryRow
          key={c.id}
          chat={{ id: c.id, title: c.title }}
          active={c.id === chatId}
          onOpen={onOpen}
          actionsOpen={actionsFor === c.id}
          onToggleActions={(row) => setActionsFor((open) => (open === row ? null : row))}
          renaming={renaming?.id === c.id}
          renameValue={renaming?.id === c.id ? renaming.value : ''}
          onStartRename={(chat: ChatHistoryChat) => setRenaming({ id: chat.id, value: chat.title })}
          onRenameChange={(value) => setRenaming((r) => (r ? { ...r, value } : r))}
          onSubmitRename={submitRename}
          onCancelRename={() => setRenaming(null)}
          labels={labels}
        />
      ))}
    </ChatHistoryList>
  );
}
