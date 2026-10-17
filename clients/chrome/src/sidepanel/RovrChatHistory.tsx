/**
 * Rovr's chat history — THE shared `ChatHistoryList` / `ChatHistoryRow` every AI surface
 * opens from its header's History lever, over the device record's chats. The row state
 * (`rows`, THE shared `useChatRowActions`) is held by the shell, because this list
 * unmounts whenever History closes. Rename writes the device record; there is no delete
 * or summarize on the device record, so the rows do not offer them.
 */
import { useMemo } from 'react';
import { ChatHistoryList, ChatHistoryRow, type ChatHistoryLabels, type ChatRowActions } from '@seanhogg/builderforce-brain-ui';
import { t } from '../i18n/t';
import type { LocalChat } from '../store/records';

export interface RovrChatHistoryProps {
  /** The element the header's History lever controls. */
  id: string;
  chats: LocalChat[];
  /** The device record's first read has not landed yet. */
  loading: boolean;
  chatId: number | null;
  rows: ChatRowActions;
}

export function RovrChatHistory({ id, chats, loading, chatId, rows }: RovrChatHistoryProps) {
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

  return (
    <ChatHistoryList id={id} className="rovr-history" loading={loading} total={chats.length} labels={labels}>
      {chats.map((c) => (
        <ChatHistoryRow
          key={c.id}
          chat={{ id: c.id, title: c.title }}
          active={c.id === chatId}
          {...rows.rowProps(c.id)}
          labels={labels}
        />
      ))}
    </ChatHistoryList>
  );
}
