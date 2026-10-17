/**
 * The editor's chat picker — THE shared `ChatHistoryList` / `ChatHistoryRow`, opened
 * from the header's History lever. It replaced a native `<select>` whose options could
 * only mark a live run or a waiting question with emoji (a native option holds no
 * icon); a row carries a labelled inline-SVG marker instead, and Rename lives on the
 * row (inline — VS Code webviews block `window.prompt`) through the shared `rename`.
 *
 * The row state (`rows`, THE shared `useChatRowActions`) is held by the surface, not
 * here: this list unmounts whenever History closes.
 */

import { useMemo } from 'react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import { ChatHistoryList, ChatHistoryRow, type ChatHistoryLabels, type ChatRowActions } from '@seanhogg/builderforce-brain-ui';
import type { ChatRunStatus } from './useVsCodeChats';

export interface VsCodeChatHistoryProps {
  id: string;
  chats: BrainChat[];
  loading: boolean;
  activeId: number | null;
  titleOf: (chat: BrainChat) => string;
  runStatus: (id: number) => ChatRunStatus;
  rows: ChatRowActions;
  t: (key: string, fallback: string) => string;
}

/** A live run (a filled dot) or a question waiting on you (a question mark in a ring). */
function RunMarker({ status, label }: { status: Exclude<ChatRunStatus, null>; label: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" role="img" aria-label={label} className={`bf-run-marker bf-run-marker--${status}`}>
      <title>{label}</title>
      {status === 'running'
        ? <circle cx="12" cy="12" r="6" fill="currentColor" />
        : (
          <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
          </g>
        )}
    </svg>
  );
}

export function VsCodeChatHistory({ id, chats, loading, activeId, titleOf, runStatus, rows, t }: VsCodeChatHistoryProps) {
  const labels = useMemo<Partial<ChatHistoryLabels>>(() => ({
    loading: t('app.historyLoading', 'Loading…'),
    empty: t('app.historyEmpty', 'No chats yet'),
    actions: t('app.chatActions', 'Chat actions'),
    actionsAria: t('app.chatActionsAria', 'Actions for {title}'),
    rename: t('app.rename', 'Rename chat'),
    summarize: t('app.chatSummarize', 'Summarize'),
    delete: t('app.chatDelete', 'Delete'),
  }), [t]);
  const runningLabel = t('app.chatRunning', 'Running');
  const awaitingLabel = t('app.chatAwaiting', 'Needs an answer');

  return (
    <ChatHistoryList id={id} loading={loading} total={chats.length} labels={labels}>
      {chats.map((chat) => {
        const status = runStatus(chat.id);
        return (
          <ChatHistoryRow
            key={chat.id}
            chat={{ id: chat.id, title: titleOf(chat), ticketCount: chat.ticketCount, ticketProgressPct: chat.ticketProgressPct }}
            active={chat.id === activeId}
            marker={status ? <RunMarker status={status} label={status === 'running' ? runningLabel : awaitingLabel} /> : undefined}
            {...rows.rowProps(chat.id)}
            labels={labels}
          />
        );
      })}
    </ChatHistoryList>
  );
}
