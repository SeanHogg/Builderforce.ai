/**
 * Rovr's chat history — THE shared `ChatHistoryList` / `ChatHistoryRow` every AI surface
 * opens from its header's History lever, over the device record's chats. The row state
 * (`rows`, THE shared `useChatRowActions`) is held by the shell, because this list
 * unmounts whenever History closes. Rename writes the device record; there is no delete
 * or summarize on the device record, so the rows do not offer them.
 */
import { useMemo } from 'react';
import {
  ChatHistoryList,
  ChatHistoryRow,
  chatHistoryLabelsFrom,
  type ChatHistoryLabels,
  type ChatRowActions,
} from '@seanhogg/builderforce-brain-ui';
import type { MessageKey } from '../i18n/t';
import { rovrLookup } from './labels/rovrLookup';
import type { LocalChat } from '../store/records';

/** Canonical chat-history key → Rovr message (one "no chats" line for both empty states). */
const CHAT_HISTORY_KEY: Readonly<Record<string, MessageKey>> = {
  loading: 'loading',
  empty: 'noChats',
  noMatch: 'noChats',
  actions: 'chatActions',
  actionsAria: 'chatActionsFor',
  rename: 'chatRename',
};

/** The rows' copy through brain-ui's one table. `chatActionsFor`'s `$1` gets the literal `{title}` the row fills. */
function rovrChatHistoryLabels(): ChatHistoryLabels {
  const lookup = rovrLookup((key) => CHAT_HISTORY_KEY[key]);
  return chatHistoryLabelsFrom((key, values) => lookup(key, key === 'actionsAria' ? { title: '{title}' } : values));
}

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
  const labels = useMemo(rovrChatHistoryLabels, []);

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
