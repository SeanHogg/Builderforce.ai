/**
 * The editor's chat picker — THE shared `ChatHistoryList` / `ChatHistoryRow`, opened
 * from the header's History lever. It replaced a native `<select>` whose options could
 * only mark a live run or a waiting question with emoji (a native option holds no
 * icon); a row carries a labelled inline-SVG marker instead, and Rename lives on the
 * row (inline — VS Code webviews block `window.prompt`) through the shared `rename`.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import { ChatHistoryList, ChatHistoryRow, type ChatHistoryChat, type ChatHistoryLabels } from '@seanhogg/builderforce-brain-ui';
import type { ChatRunStatus } from './useVsCodeChats';

export interface VsCodeChatHistoryProps {
  id: string;
  chats: BrainChat[];
  activeId: number | null;
  titleOf: (chat: BrainChat) => string;
  runStatus: (id: number) => ChatRunStatus;
  onOpen: (id: number) => void;
  rename: (id: number, title: string) => Promise<void>;
  summarize: (id: number) => Promise<void>;
  remove: (chat: { id: number; title: string }) => void;
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

export function VsCodeChatHistory({ id, chats, activeId, titleOf, runStatus, onOpen, rename, summarize, remove, t }: VsCodeChatHistoryProps) {
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Enter commits and unmounts the input, whose blur may then commit again — one write.
  const committing = useRef<number | null>(null);

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

  const startRename = useCallback((chat: ChatHistoryChat) => {
    committing.current = null;
    setRenameValue(chat.title);
    setRenamingId(chat.id);
    setActionsFor(null);
  }, []);
  // A blank/unchanged title just cancels (no needless write).
  const submitRename = useCallback((chatId: number, value: string) => {
    if (committing.current === chatId) return;
    committing.current = chatId;
    setRenamingId(null);
    const title = value.trim();
    const current = chats.find((c) => c.id === chatId)?.title;
    if (!title || title === current) return;
    void rename(chatId, title);
  }, [chats, rename]);
  const onSummarize = useCallback((chatId: number) => {
    setSummarizingId(chatId);
    void summarize(chatId).finally(() => setSummarizingId((cur) => (cur === chatId ? null : cur)));
  }, [summarize]);
  const onDelete = useCallback((chat: ChatHistoryChat) => {
    setActionsFor(null);
    remove({ id: chat.id, title: chat.title });
  }, [remove]);
  const toggleActions = useCallback((chatId: number) => setActionsFor((cur) => (cur === chatId ? null : chatId)), []);

  return (
    <ChatHistoryList id={id} total={chats.length} labels={labels}>
      {chats.map((chat) => {
        const status = runStatus(chat.id);
        return (
          <ChatHistoryRow
            key={chat.id}
            chat={{ id: chat.id, title: titleOf(chat), ticketCount: chat.ticketCount, ticketProgressPct: chat.ticketProgressPct }}
            active={chat.id === activeId}
            onOpen={onOpen}
            marker={status ? <RunMarker status={status} label={status === 'running' ? runningLabel : awaitingLabel} /> : undefined}
            actionsOpen={actionsFor === chat.id}
            onToggleActions={toggleActions}
            renaming={renamingId === chat.id}
            renameValue={renameValue}
            onStartRename={startRename}
            onRenameChange={setRenameValue}
            onSubmitRename={submitRename}
            onCancelRename={() => { committing.current = chat.id; setRenamingId(null); }}
            onSummarize={onSummarize}
            summarizing={summarizingId === chat.id}
            onDelete={onDelete}
            labels={labels}
          />
        );
      })}
    </ChatHistoryList>
  );
}
