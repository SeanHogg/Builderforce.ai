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
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
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
  ticketStats: 'chatTicketStats',
  ticketStatsAria: 'chatTicketStatsAria',
  ticketStatsCount: 'chatTicketStatsCount',
  ticketStatsCountAria: 'chatTicketStatsCountAria',
  ticketStatsCountOnly: 'chatTicketStatsCountOnly',
  ticketStatsCountOne: 'chatTicketStatsCountOne',
  untitled: 'chatUntitled',
  ticketStatsNone: 'chatTicketStatsNone',
};

/**
 * The literal `{name}` placeholders the shared row fills itself, in each message's
 * positional order (`$1`, `$2`, …) — Chrome substitutes them back as written.
 */
const LITERAL_PLACEHOLDERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  actionsAria: { title: '{title}' },
  ticketStats: { pct: '{pct}', open: '{open}', done: '{done}' },
  ticketStatsAria: { pct: '{pct}', open: '{open}', done: '{done}' },
  ticketStatsCount: { pct: '{pct}', count: '{count}' },
  ticketStatsCountAria: { pct: '{pct}', count: '{count}' },
  ticketStatsCountOnly: { count: '{count}' },
  ticketStatsCountOne: { count: '{count}' },
  untitled: { id: '{id}' },
};

/** The rows' copy through brain-ui's one table, placeholders handed through literally. */
function rovrChatHistoryLabels(): ChatHistoryLabels {
  const lookup = rovrLookup((key) => CHAT_HISTORY_KEY[key]);
  return chatHistoryLabelsFrom((key, values) => lookup(key, LITERAL_PLACEHOLDERS[key] ?? values));
}

export interface RovrChatHistoryProps {
  /** The element the header's History lever controls. */
  id: string;
  chats: LocalChat[];
  /** The device record's first read has not landed yet. */
  loading: boolean;
  chatId: number | null;
  rows: ChatRowActions;
  /**
   * Synced server chats by serverId — the platform rollup (`ticketCount`,
   * `ticketProgressPct`, open/done counts) the device record does not carry. A chat with no
   * entry (unsynced, offline, signed out) renders title-only, as before.
   */
  serverChats?: ReadonlyMap<number, BrainChat>;
}

export function RovrChatHistory({ id, chats, loading, chatId, rows, serverChats }: RovrChatHistoryProps) {
  const labels = useMemo(rovrChatHistoryLabels, []);

  return (
    <ChatHistoryList id={id} className="rovr-history" loading={loading} total={chats.length} labels={labels}>
      {chats.map((c) => {
        const serverChat = c.serverId != null ? serverChats?.get(c.serverId) : undefined;
        return (
          <ChatHistoryRow
            key={c.id}
            chat={{
              id: c.id,
              title: c.title,
              // The shared row renders the linked-ticket column (`ChatTicketStats`)
              // from these — same read as the web and the editor.
              ticketCount: serverChat?.ticketCount,
              ticketProgressPct: serverChat?.ticketProgressPct,
              ticketOpenCount: serverChat?.ticketOpenCount,
              ticketDoneCount: serverChat?.ticketDoneCount,
            }}
            active={c.id === chatId}
            {...rows.rowProps(c.id)}
            labels={labels}
          />
        );
      })}
    </ChatHistoryList>
  );
}
