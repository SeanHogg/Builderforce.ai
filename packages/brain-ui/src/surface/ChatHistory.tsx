import { memo, type ReactNode } from 'react';
import { stringsFrom, type LabelLookup } from '../labelCatalog';
import { fill } from '../spend/format';
import { ChatTicketStats, type ChatTicketStatsLabels } from './ChatTicketStats';

/**
 * The ONE chat-history list every AI surface opens from its header's History lever —
 * moved from the web Brain panel (`BrainChatList` / `BrainChatRow`) so the editor's and
 * Rovr's native `<select>` pickers become the same rows.
 *
 * A row is the title (or its rename input), its linked-ticket column (`ChatTicketStats`,
 * on every row — the host never recomposes it), a meta line the host fills (project tag,
 * time, attention, unread — `meta`), and its revealed actions: Rename / Summarize /
 * Delete, each offered only when the host supplies its handler, plus host extras
 * (`extraActions`, e.g. "Add to project"). Rows reveal actions per-row, not "whatever
 * is selected": opening a chat leaves the history view, so tying actions to the
 * selection put them somewhere nobody can see.
 */

export interface ChatHistoryLabels extends ChatTicketStatsLabels {
  loading: string;
  /** No chats at all. */
  empty: string;
  /** Chats exist, but none match the host's filter. */
  noMatch: string;
  actions: string;
  /** "Actions for {title}". */
  actionsAria: string;
  rename: string;
  summarize: string;
  delete: string;
  archive: string;
  /** Restore an archived chat to the live list (offered on an already-archived row). */
  unarchive: string;
  /** "Chat {id}" — a row whose title is blank. */
  untitled: string;
  /** A short idle-age chip label, e.g. `{days}D` → `5D`. */
  daysIdle: string;
  /** An interrupted-run row's status tag (`· Interrupted`). */
  interrupted: string;
  /** An interrupted-run row's Open chat action. */
  openChat: string;
  /** An interrupted-run row's Resume action. */
  resume: string;
  /** An interrupted-run row's Dismiss action. */
  dismiss: string;
  /** The interrupted-run row's note when a resume failed. */
  resumeFailed: string;
}

export const DEFAULT_CHAT_HISTORY_LABELS: ChatHistoryLabels = {
  loading: 'Loading…',
  empty: 'No chats yet',
  noMatch: 'No chats match',
  actions: 'Chat actions',
  actionsAria: 'Actions for {title}',
  rename: 'Rename',
  summarize: 'Summarize',
  delete: 'Delete',
  archive: 'Archive',
  unarchive: 'Unarchive',
  untitled: 'Chat {id}',
  daysIdle: '{days}D',
  ticketStats: '{pct}% · {open} open · {done} done',
  ticketStatsAria: '{pct}% complete: {open} open and {done} done tickets',
  ticketStatsCount: '{pct}% · {count} tickets',
  ticketStatsCountAria: '{pct}% complete across {count} tickets',
  ticketStatsCountOnly: '{count} tickets',
  ticketStatsCountOne: '{count} ticket',
  ticketStatsNone: 'No tickets',
  interrupted: 'Interrupted',
  openChat: 'Open chat',
  resume: 'Resume',
  dismiss: 'Dismiss',
  resumeFailed: "Couldn't resume",
};

/** THE chat-history copy from a host catalog (canonical keys = the field names). */
export function chatHistoryLabelsFrom(lookup: LabelLookup): ChatHistoryLabels {
  return stringsFrom(DEFAULT_CHAT_HISTORY_LABELS, lookup);
}

export interface ChatHistoryChat {
  id: number;
  title: string;
  ticketCount?: number | null;
  /** Non-cancelled linked tickets below 100%. Absent (older server) = unknown, not 0. */
  ticketOpenCount?: number | null;
  /** Non-cancelled linked tickets at 100%. Absent (older server) = unknown, not 0. */
  ticketDoneCount?: number | null;
  /**
   * Full days since the chat was last touched / last executed (now - `updatedAt`). The
   * row renders this as a short chip (e.g. `5D`) so a stale chat is obvious at a glance.
   * Absent/unknown ⇒ no chip.
   */
  daysIdle?: number | null;
  /**
   * Per-row cost chips the host wants beside the overflow menu — e.g. the VSIX
   * history's `2 agents · $1.20/$3.40`. Linked-ticket progress is NOT composed here:
   * the row renders it itself (`ChatTicketStats`) from the ticket fields above.
   * A short string the host has already composed; the row renders it verbatim (null/empty = no chip). Kept opaque so the shared row
   * does not own each surface's spend formatting.
   */
  stats?: string | null;
}

export interface ChatHistoryListProps {
  loading?: boolean;
  /** How many chats exist before the host's filter (picks empty vs no-match). */
  total: number;
  /** The rows (`ChatHistoryRow`s) — the host maps its own chat model onto them. */
  children?: ReactNode;
  /**
   * A host-rendered header ABOVE the rows — the search box + archive toggle. The
   * slot takes a ReactNode (not state) so the LIST stays stateless: the filter/
   * toggle STATE lives in the surface shell (the list unmounts whenever History
   * closes, which would drop state held inside the list).
   */
  filter?: ReactNode;
  labels?: Partial<ChatHistoryLabels>;
  id?: string;
  className?: string;
}

/**
 * A chat that has one or more interrupted runs: the history shows THIS row instead of
 * the normal (completed/live) row, so the person never sees the same chat twice — once
 * as interrupted, once in the plain list below. The surface that owns the interrupted
 * runs (the VSIX) folds them in here; surfaces without interrupted runs omit the prop
 * and render the plain list unchanged.
 */
export interface InterruptedChatState {
  /**
   * The run's id: the key the host journals an acknowledgement by
   * (`run.acknowledgeInterrupted`). Each row is one run; a chat with several has several.
   */
  runId: string;
  /**
   * The interrupt timestamp, rendered in the surface's locale by the host (this component
   * is data-only and stays locale-free, so every surface shows it the same way).
   */
  interruptedAtLabel: string;
  /** A run with no recoverable chat hides Resume / Open chat (Dismiss still works). */
  resumable: boolean;
  /** A pending resume disables every action; the surface tracks it by runId. */
  pending: boolean;
  /** The row's note when a resume failed (`Couldn't resume`). */
  failed: boolean;
  /** Open the run's chat (the surface's `onOpenChat`). */
  onOpen?: () => void;
  /** Resume the run (open its chat and send the continuation). Disabled when not resumable. */
  onResume?: () => void;
  /** Acknowledge / dismiss the run so it leaves the list. */
  onDismiss?: () => void;
  labels?: Partial<ChatHistoryLabels>;
}

/**
 * ONE interrupted run as a history row: the run's chat title, when it was interrupted,
 * and its Resume / Open chat / Dismiss actions. The host renders one per interrupted
 * run and places each next to the normal rows, so the history is a single consolidated
 * list — a chat with an interrupted run appears here, NOT again as a normal row below.
 */
export function InterruptedRunRow({ state, className }: { state: InterruptedChatState; className?: string }) {
  const labels = { ...DEFAULT_CHAT_HISTORY_LABELS, ...state.labels };
  const disabled = state.pending;
  return (
    <div
      className={['bf-chatrow', 'bf-chatrow--interrupted', className].filter(Boolean).join(' ')}
      role="listitem"
      data-run-id={state.runId}
    >
      <div className="bf-chatrow__head">
        <span className="bf-chatrow__marker" aria-hidden>
          {/* A broken-circle glyph marks an interrupted run the way a dot marks a live one. */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 2a10 10 0 0 1 10 10" />
            <path d="M12 22A10 10 0 1 1 22 12" />
          </svg>
        </span>
        <span className="bf-chatrow__title">{state.interruptedAtLabel}</span>
        <span className="bf-chatrow__meta">· {labels.interrupted ?? 'Interrupted'}</span>
      </div>
      {state.failed && !state.pending && (
        <div className="bf-chatrow__meta" role="alert">{labels.resumeFailed ?? "Couldn't resume"}</div>
      )}
      <div className="bf-chatrow__actions">
        {state.resumable && state.onOpen && (
          <button type="button" className="bf-chatrow__action" disabled={disabled} onClick={state.onOpen}>
            {labels.openChat ?? 'Open chat'}
          </button>
        )}
        {state.resumable && state.onResume && (
          <button type="button" className="bf-chatrow__action" disabled={disabled} onClick={state.onResume}>
            {labels.resume ?? 'Resume'}
          </button>
        )}
        {state.onDismiss && (
          <button type="button" className="bf-chatrow__action" disabled={disabled} onClick={state.onDismiss}>
            {labels.dismiss ?? 'Dismiss'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatHistoryList({ loading, total, children, filter, labels: overrides, id, className }: ChatHistoryListProps) {
  const labels = { ...DEFAULT_CHAT_HISTORY_LABELS, ...overrides };
  const hasRows = Array.isArray(children) ? children.length > 0 : children != null && children !== false;
  // The status line is a live SIBLING of the rows, not a child of role="list" (a list
  // may only own listitems).
  const status = loading ? labels.loading : !hasRows ? (total === 0 ? labels.empty : labels.noMatch) : null;
  return (
    <div id={id} className={['bf-history', className].filter(Boolean).join(' ')}>
      {filter != null && <div className="bf-history__filter">{filter}</div>}
      {status != null && <div className="bf-history__status" role="status">{status}</div>}
      {hasRows && <div role="list" className="bf-history__rows">{children}</div>}
    </div>
  );
}

export interface ChatHistoryRowProps {
  chat: ChatHistoryChat;
  active: boolean;
  onOpen: (id: number) => void;
  /** The meta line under the title (project tag, time, attention, unread). */
  meta?: ReactNode;
  /** A glyph before the title (a live run, a question waiting). */
  marker?: ReactNode;
  actionsOpen?: boolean;
  onToggleActions?: (id: number) => void;
  renaming?: boolean;
  renameValue?: string;
  onStartRename?: (chat: ChatHistoryChat) => void;
  onRenameChange?: (value: string) => void;
  onSubmitRename?: (id: number, value: string) => void;
  onCancelRename?: () => void;
  onSummarize?: (id: number) => void;
  summarizing?: boolean;
  onArchive?: (chat: ChatHistoryChat) => void;
  archiving?: boolean;
  /** The chat is already archived, so its row does not offer Archive again. */
  archived?: boolean;
  /**
   * Restore an archived chat to the live list — the mirror of `onArchive`, offered on
   * an already-archived row only. Rows offer it when the host supplies it.
   */
  onUnarchive?: (chat: ChatHistoryChat) => void;
  unarchiving?: boolean;
  onDelete?: (chat: ChatHistoryChat) => void;
  deleting?: boolean;
  /** Host actions after the standard ones (the web's "Add to project"). */
  extraActions?: ReactNode;
  labels?: Partial<ChatHistoryLabels>;
  className?: string;
}

/** One chat-history row: title (or its rename input), meta line, and its revealed actions. */
export const ChatHistoryRow = memo(function ChatHistoryRow({
  chat, active, onOpen, meta, marker, actionsOpen = false, onToggleActions, renaming = false, renameValue = '',
  onStartRename, onRenameChange, onSubmitRename, onCancelRename, onSummarize, summarizing = false,
  onArchive, archiving = false, archived = false, onUnarchive, unarchiving = false, onDelete, deleting = false, extraActions, labels: overrides, className,
}: ChatHistoryRowProps) {
  const labels = { ...DEFAULT_CHAT_HISTORY_LABELS, ...overrides };
  const submitRename = () => onSubmitRename?.(chat.id, renameValue);
  const daysIdle =
    chat.daysIdle != null && Number.isFinite(chat.daysIdle) && chat.daysIdle >= 1
      ? fill(labels.daysIdle, { days: Math.floor(chat.daysIdle) })
      : null;
  // An archived chat has no Archive to offer — the row would be offering the state it
  // is already in. `hasActions` ignores it for the same reason, so the "more" menu
  // still opens for a host that offers nothing else on that row.
  const canArchive = Boolean(onArchive) && !archived;
  const hasActions = Boolean(onStartRename || onSummarize || canArchive || onDelete || extraActions);
  return (
    <div
      className={['bf-chatrow', className].filter(Boolean).join(' ')}
      data-active={active ? 'true' : undefined}
      role="listitem"
    >
      <div className="bf-chatrow__head">
        {/* While renaming the input IS the row's title — no nameless disabled button beside it. */}
        {renaming ? (
          marker != null && <span className="bf-chatrow__marker">{marker}</span>
        ) : (
          <button
            type="button"
            className="bf-chatrow__open"
            aria-current={active ? 'true' : undefined}
            onClick={() => onOpen(chat.id)}
          >
            {marker != null && <span className="bf-chatrow__marker">{marker}</span>}
            <span className="bf-chatrow__title">{chat.title.trim() || fill(labels.untitled, { id: chat.id })}</span>
          </button>
        )}
        {renaming && (
          <input
            autoFocus
            className="bf-chatrow__rename"
            value={renameValue}
            aria-label={labels.rename}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') onCancelRename?.();
            }}
          />
        )}
        {!renaming && <ChatTicketStats chat={chat} labels={labels} />}
        {!renaming && daysIdle != null && (
          <span className="bf-chatrow__days" title={daysIdle}>{daysIdle}</span>
        )}
        {!renaming && chat.stats != null && chat.stats !== '' && (
          <span className="bf-chatrow__stats" title={chat.stats}>{chat.stats}</span>
        )}
        {!renaming && hasActions && onToggleActions && (
          <button
            type="button"
            className="bf-chatrow__more"
            aria-expanded={actionsOpen}
            aria-label={labels.actionsAria.replace('{title}', chat.title)}
            title={labels.actions}
            onClick={() => onToggleActions(chat.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        )}
      </div>
      {meta != null && <div className="bf-chatrow__meta">{meta}</div>}
      {actionsOpen && !renaming && hasActions && (
        <div className="bf-chatrow__actions">
          {onStartRename && <button type="button" className="bf-chatrow__action" onClick={() => onStartRename(chat)}>{labels.rename}</button>}
          {onSummarize && (
            <button type="button" className="bf-chatrow__action" onClick={() => onSummarize(chat.id)} disabled={summarizing} aria-busy={summarizing || undefined}>
              {labels.summarize}{summarizing && <span aria-hidden>…</span>}
            </button>
          )}
          {canArchive && (
            <button type="button" className="bf-chatrow__action" onClick={() => onArchive?.(chat)} disabled={archiving} aria-busy={archiving || undefined}>
              {labels.archive}{archiving && <span aria-hidden>…</span>}
            </button>
          )}
          {/* The mirror of Archive — restore an already-archived chat to the live list. */}
          {onUnarchive && archived && (
            <button type="button" className="bf-chatrow__action" onClick={() => onUnarchive(chat)} disabled={unarchiving} aria-busy={unarchiving || undefined}>
              {labels.unarchive}{unarchiving && <span aria-hidden>…</span>}
            </button>
          )}
          {onDelete && (
            <button type="button" className="bf-chatrow__action bf-chatrow__action--danger" onClick={() => onDelete(chat)} disabled={deleting} aria-busy={deleting || undefined}>
              {labels.delete}{deleting && <span aria-hidden>…</span>}
            </button>
          )}
          {extraActions}
        </div>
      )}
    </div>
  );
});
