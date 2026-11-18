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

import { useCallback, useMemo } from 'react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import { ChatHistoryList, ChatHistoryRow, InterruptedRunRow, type ChatRowActions, type InterruptedChatState } from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';
import { chatHistoryLabels, makeT } from './chatLabels';
import { useChatChildrenCount } from './chatChildren';
import { acknowledgeInterruptedRun, useInterruptedRuns } from './interruptedRunsStore';
import { interruptedCompleteIds as dedicatedInterruptedIdSet, resumableInterruptedRun as resumableInterruptedRunOf } from './interruptedRowPolicy';
import { interruptedWhen } from './interruptedWhen';
import { daysIdleOf } from './chatIdle';
import type { InterruptedResume } from './useInterruptedResume';
import type { ChatRunStatus } from './useVsCodeChats';

/** `$1.20` — always two decimals so the chip's width stays stable across rows. */
function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * The per-row cost chip the history shows beside the overflow menu: the
 * sub-agents that ran on the chat (live when any, else the announced total this
 * session) and the chat's `$ spent / $ saved` rollup (when the server attached
 * one). Linked-ticket progress is NOT here — the shared row renders it itself
 * (`ChatTicketStats`). Absent pieces are omitted, not a wall of zeros.
 */
function runStatsOf(chat: BrainChat, agents: number, t: (key: string, fallback: string) => string): string | null {
  const parts: string[] = [];
  if (agents > 0) {
    parts.push(t('app.chatStatsAgents', '{count} agents').replace('{count}', String(agents)));
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
  /** Open a chat by id (an interrupted run's chat link). */
  onOpenChat: (id: number) => void;
  /** The editor's locale (`init.locale`). */
  locale: string | undefined;
  /** A chat's title by id (undefined when unknown), for the interrupted rows. */
  chatTitleOf: (chatId: number) => string | undefined;
  /** Resume state of the interrupted rows (`useInterruptedResume`). */
  interrupted: InterruptedResume;
  /** The host's label bundle. */
  bundle: LabelBundle;
}

/** A live run (a filled dot), a question waiting on you (a question mark in a ring), or an interrupted run (a broken ring). */
function RunMarker({ status, label }: { status: 'running' | 'awaiting' | 'interrupted'; label: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" role="img" aria-label={label} className={`bf-run-marker bf-run-marker--${status}`}>
      <title>{label}</title>
      {status === 'running'
        ? <circle cx="12" cy="12" r="6" fill="currentColor" />
        : status === 'interrupted'
          ? (
            /* The same broken-circle glyph the dedicated InterruptedRunRow uses. */
            <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M12 2a10 10 0 0 1 10 10" />
              <path d="M12 22A10 10 0 1 1 22 12" />
            </g>
          )
          : (
            <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
            </g>
          )}
    </svg>
  );
}

export function VsCodeChatHistory({ id, chats, total, loading, activeId, titleOf, runStatus, rows, query, onQueryChange, showArchived, onToggleArchived, onOpenChat, locale, chatTitleOf, interrupted, bundle }: VsCodeChatHistoryProps) {
  const labels = useMemo(() => chatHistoryLabels(bundle), [bundle]);
  const t = makeT(bundle);
  const interruptedRuns = useInterruptedRuns();

  // One resume per chat at a time (`interruptedResume.ts`): another run's pending resume blocks this chat's Resume.
  const pendingChats = useMemo(
    () => new Set(interruptedRuns.filter((r) => interrupted.pending.has(r.runId)).map((r) => Number(r.chatId))),
    [interruptedRuns, interrupted.pending],
  );

  // The interrupted-run row policy (which chats stay dedicated interrupted rows, which
  // normal rows carry a Resume) is pure — `interruptedRowPolicy.ts`; these callbacks
  // just bind the render's store snapshot. A chat's interrupted run, when it has exactly
  // the resumable state we attach a Resume action to: the chat is interrupted AND not
  // 100% complete. Interrupted-but-complete chats are left to the dedicated interrupted
  // rows (their ▶ would be a no-op), so this stays undefined for them.
  const resumableInterruptedRun = useCallback(
    (chat: BrainChat) => resumableInterruptedRunOf(chat.id, chat.ticketProgressPct, interruptedRuns, interrupted),
    [interruptedRuns, interrupted],
  );

  // A chat that is interrupted AND 100% complete still renders as a dedicated interrupted
  // row (it is finished — its Resume would be a no-op). Every other interrupted chat is
  // shown as a NORMAL row carrying the Resume action, so it is never duplicated (once
  // interrupted, once plain) the way the old blanket filter avoided.
  const dedicatedInterruptedIds = useMemo(
    () => dedicatedInterruptedIdSet(chats.map((c) => c.id), interruptedRuns, interrupted, (id: number) => chats.find((c) => c.id === id)?.ticketProgressPct),
    [chats, interruptedRuns, interrupted],
  );

  // One row per chat: a resumable interrupted chat (under 100%, not running, no resume
  // in flight) renders as its chat's SINGLE normal row below — an interrupted marker plus
  // the Resume action — NOT again as a dedicated interrupted row. Only NON-resumable
  // interrupted chats (complete, running, or a resume already pending) and runs whose
  // chat is unknown keep a dedicated interrupted row.
  const interruptedStates: InterruptedChatState[] = useMemo(() => interruptedRuns
    .filter((run) => {
      const chatId = run.chatId != null ? Number(run.chatId) : NaN;
      return !Number.isInteger(chatId) || dedicatedInterruptedIds.has(chatId);
    })
    .map((run) => {
    const chatId = run.chatId != null ? Number(run.chatId) : NaN;
    const hasChat = Number.isInteger(chatId);
    const pending = interrupted.pending.has(run.runId);
    const running = hasChat && interrupted.isRunning(chatId);
    const chatPending = hasChat && !pending && pendingChats.has(chatId);
    const disabled = pending || running || chatPending;
    return {
      runId: run.runId,
      // Titled by its chat (the title the history list uses) + when it was interrupted;
      // the run's short id when the chat is unknown. `interruptedWhen` renders the ISO in
      // the editor's locale; the shared row stays locale-free and shows this verbatim.
      interruptedAtLabel: `${(hasChat ? chatTitleOf(chatId) : undefined) ?? run.runId.slice(0, 8)} · ${interruptedWhen(run.interruptedAt, locale)}`,
      resumable: hasChat && !running && !chatPending,
      pending,
      failed: interrupted.failed.has(run.runId),
      onOpen: hasChat ? () => onOpenChat(chatId) : undefined,
      onResume: hasChat && !disabled ? () => interrupted.resume({ runId: run.runId, chatId }) : undefined,
      onDismiss: () => acknowledgeInterruptedRun(run.runId),
      labels,
    };
    }),
    [interruptedRuns, interrupted, pendingChats, dedicatedInterruptedIds, chatTitleOf, onOpenChat, locale, labels],
  );

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
      {interruptedStates.map((state) => (
        <InterruptedRunRow key={state.runId} state={state} />
      ))}
      {chats.filter((chat) => !dedicatedInterruptedIds.has(chat.id)).map((chat) => {
        const target = resumableInterruptedRun(chat);
        return (
          <VsCodeChatHistoryRow
            key={chat.id}
            chat={chat}
            active={chat.id === activeId}
            titleOf={titleOf}
            runStatus={runStatus}
            rows={rows}
            labels={labels}
            bundle={bundle}
            // The chat has a journaled interrupted run and renders as this ONE normal row:
            // it carries the interrupted marker (its current state) alongside the Resume action.
            interrupted={interruptedRuns.some((r) => r.chatId != null && Number(r.chatId) === chat.id)}
            // The interrupted, not-100% rows carry the same Resume the dedicated
            // interrupted rows offer — one mechanism (`interrupted.resume`), injected
            // through the shared row's `extraActions` slot.
            resumeAction={target ? {
              runId: target.runId,
              chatId: target.chatId,
              journaled: target.journaled,
              pending: target.journaled && interrupted.pending.has(target.runId),
              onResume: () => {
                // Both journaled and open-only targets resume through the tracker: it opens
                // the chat and sends a continuation turn (the journaled run's record, or an
                // open-only turn scoped to this chat's linked tickets). The play button never
                // just opens the chat silently — it always continues the work.
                void interrupted.resume({ runId: target.runId, chatId: target.chatId });
              },
            } : undefined}
          />
        );
      })}
    </ChatHistoryList>
  );
}

/** The interrupted-run Resume affordance for a normal row: which run (or open-only target), its resume action, and whether that resume is in flight. */
interface ResumeAction {
  /** The journaled run's id, or `open-<chatId>` for an open-only (no journaled run) target. */
  runId: string;
  chatId: number;
  /** True when a journaled run's continuation is sent; false when the action only opens the chat. */
  journaled: boolean;
  /** True while `interrupted.resume` has this run pending (the play button disables). */
  pending: boolean;
  onResume: () => void;
}

/** One history row. Hooks live here (not in the list's `.map`) so they run unconditionally. */
function VsCodeChatHistoryRow({
  chat, active, titleOf, runStatus, rows, labels, bundle, resumeAction, interrupted = false,
}: {
  chat: BrainChat;
  active: boolean;
  titleOf: (chat: BrainChat) => string;
  runStatus: (id: number) => ChatRunStatus;
  rows: ChatRowActions;
  labels: ReturnType<typeof chatHistoryLabels>;
  bundle: LabelBundle;
  resumeAction?: ResumeAction;
  /** The chat has a journaled interrupted run: the row carries the interrupted marker. */
  interrupted?: boolean;
}) {
  const t = makeT(bundle);
  const status = runStatus(chat.id);
  // A resume is in flight for this row's journaled run: the play button disables (like
  // the dedicated interrupted rows) until it is claimed or fails.
  const interruptedPending = resumeAction != null && resumeAction.journaled && resumeAction.pending;
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
        ticketOpenCount: chat.ticketOpenCount,
        ticketDoneCount: chat.ticketDoneCount,
        stats: runStatsOf(chat, agents, t),
        // Full days since `updatedAt` (last touched / last executed) — the row's
        // `5D` chip. The threshold that flips a stale chat into the archive sweep
        // below rides init from the host setting.
        daysIdle: daysIdleOf(chat),
      }}
      active={active}
      marker={status ? <RunMarker status={status} label={status === 'running' ? t('app.chatRunning', 'Running') : t('app.chatAwaiting', 'Needs an answer')} /> : interrupted ? <RunMarker status="interrupted" label={labels.interrupted ?? 'Interrupted'} /> : undefined}
      {...rows.rowProps(chat.id)}
      labels={labels}
      // The interrupted, not-100% rows get the same Resume the dedicated interrupted
      // rows offer, injected here through the shared row's `extraActions` slot so the
      // shared component stays host-agnostic. The play glyph matches the dedicated
      // rows' `ACTION_ICONS.resume` triangle.
      extraActions={resumeAction ? (
        <button
          type="button"
          className="bf-chatrow__action"
          title={labels.resume}
          aria-label={labels.resume}
          disabled={interruptedPending}
          aria-busy={interruptedPending || undefined}
          onClick={resumeAction.onResume}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={labels.resume}>
            <title>{labels.resume}</title>
            <path d="m6 4 14 8-14 8Z" />
          </svg>
        </button>
      ) : undefined}
    />
  );
}
