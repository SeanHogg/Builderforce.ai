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
import { ChatHistoryList, ChatHistoryRow, type ChatRowActions } from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';
import { chatHistoryLabels, makeT } from './chatLabels';
import { useChatChildrenCount } from './chatChildren';
import type { ChatRunStatus } from './useVsCodeChats';

/** `$1.20` — always two decimals so the chip's width stays stable across rows. */
function usd(n: number): string {
  return `${n.toFixed(2)}`;
}

/**
 * The per-row cost/progress chip the history shows beside the overflow menu:
 * the sub-agents that ran on the chat (live when any, else the announced total
 * this session), the linked tickets and % done (when the chat has any), and the
 * chat's `$ spent / $ saved` rollup (when the server attached one). Absent
 * pieces are simply omitted so a chat with no usage reads as its title only,
 * not a wall of zeros.
 */
function runStatsOf(chat: BrainChat, agents: number, t: (key: string, fallback: string) => string): string | null {
  const parts: string[] = [];
  if (agents > 0) {
    parts.push(t('app.chatStatsAgents', '{count} agents').replace('{count}', String(agents)));
  }
  const count = chat.ticketCount ?? 0;
  const pct = chat.ticketProgressPct;
  if (count > 0 && typeof pct === 'number' && Number.isFinite(pct)) {
    parts.push(t('app.chatStatsTickets', '{count} tickets').replace('{count}', String(count)));
    parts.push(t('app.chatStatsPct', '{pct}%').replace('{pct}', String(Math.round(pct))));
  }
  const spend = chat.spend;
  if (spend) {
    const s = usd(spend.spend.totalUsd);
    const v = usd(spend.saved.netUsd);
    if (spend.spend.totalUsd > 0 || spend.saved.netUsd > 0) parts.push(`${s}/${v}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface VsCodeChatHistoryProps {
  id: string;
  chats: BrainChat[];
  /** How many chats exist in the current view BEFORE the search filter (empty vs no-match). */
  total: number;
  loading: boolean;
  activeId: number | null;
  titleOf: (chat: BrainChat) => string;
  runStatus: (id: number) => ChatRunStatus;
  rows: ChatRowActions;
  /** The search box's value + setter (state lives in the surface, the list is stateless). */
  query: string;
  onQueryChange: (value: string) => void;
  /** Archived view toggle: false = live chats, true = archived chats. */
  showArchived: boolean;
  onToggleArchived: () => void;
  /** The host's label bundle. */
  bundle: LabelBundle;
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

export function VsCodeChatHistory({ id, chats, total, loading, activeId, titleOf, runStatus, rows, query, onQueryChange, showArchived, onToggleArchived, bundle }: VsCodeChatHistoryProps) {
  const labels = useMemo(() => chatHistoryLabels(bundle), [bundle]);
  const t = makeT(bundle);

  const filter = (
    <div className="bf-history__controls">
      <input
        type="search"
        className="bf-history__search"
        value={query}
        aria-label={t('app.historySearch', 'Search chats')}
        placeholder={t('app.historySearch', 'Search chats')}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <button
        type="button"
        className="bf-history__toggle"
        aria-pressed={showArchived}
        onClick={onToggleArchived}
      >
        {showArchived ? t('app.historyShowLive', 'Live') : t('app.historyShowArchived', 'Archived')}
      </button>
    </div>
  );

  return (
    <ChatHistoryList id={id} loading={loading} total={total} filter={filter} labels={labels}>
      {chats.map((chat) => (
        <VsCodeChatHistoryRow
          key={chat.id}
          chat={chat}
          active={chat.id === activeId}
          titleOf={titleOf}
          runStatus={runStatus}
          rows={rows}
          labels={labels}
          bundle={bundle}
        />
      ))}
    </ChatHistoryList>
  );
}

/** One history row. Hooks live here (not in the list's `.map`) so they run unconditionally. */
function VsCodeChatHistoryRow({
  chat, active, titleOf, runStatus, rows, labels, bundle,
}: {
  chat: BrainChat;
  active: boolean;
  titleOf: (chat: BrainChat) => string;
  runStatus: (id: number) => ChatRunStatus;
  rows: ChatRowActions;
  labels: ReturnType<typeof chatHistoryLabels>;
  bundle: LabelBundle;
}) {
  const t = makeT(bundle);
  const status = runStatus(chat.id);
  // Live count while sub-agents are announced; the session's announced total once
  // they settle — so a chat that HAD agents still says so, and the chip re-renders
  // the moment the host announces (or settles) a child, unlike a one-shot read.
  const agents = useChatChildrenCount(chat.id);

  return (
    <ChatHistoryRow
      chat={{
        id: chat.id,
        title: titleOf(chat),
        ticketCount: chat.ticketCount,
        ticketProgressPct: chat.ticketProgressPct,
        stats: runStatsOf(chat, agents, t),
      }}
      active={active}
      marker={status ? <RunMarker status={status} label={status === 'running' ? t('app.chatRunning', 'Running') : t('app.chatAwaiting', 'Needs an answer')} /> : undefined}
      {...rows.rowProps(chat.id)}
      labels={labels}
    />
  );
}
