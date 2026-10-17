import { memo, type ReactNode } from 'react';
import { chatSwitcherLabel } from '../chatTickets/chatSwitcherLabel';

/**
 * The ONE chat-history list every AI surface opens from its header's History lever —
 * moved from the web Brain panel (`BrainChatList` / `BrainChatRow`) so the editor's and
 * Rovr's native `<select>` pickers become the same rows.
 *
 * A row is the title (or its rename input), a meta line the host fills (project tag,
 * time, attention, unread — `meta`), and its revealed actions: Rename / Summarize /
 * Delete, each offered only when the host supplies its handler, plus host extras
 * (`extraActions`, e.g. "Add to project"). Rows reveal actions per-row, not "whatever
 * is selected": opening a chat leaves the history view, so tying actions to the
 * selection put them somewhere nobody can see.
 */

export interface ChatHistoryLabels {
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
};

export interface ChatHistoryChat {
  id: number;
  title: string;
  ticketCount?: number | null;
  ticketProgressPct?: number | null;
}

export interface ChatHistoryListProps {
  loading?: boolean;
  /** How many chats exist before the host's filter (picks empty vs no-match). */
  total: number;
  /** The rows (`ChatHistoryRow`s) — the host maps its own chat model onto them. */
  children?: ReactNode;
  labels?: Partial<ChatHistoryLabels>;
  id?: string;
  className?: string;
}

export function ChatHistoryList({ loading, total, children, labels: overrides, id, className }: ChatHistoryListProps) {
  const labels = { ...DEFAULT_CHAT_HISTORY_LABELS, ...overrides };
  const hasRows = Array.isArray(children) ? children.length > 0 : children != null && children !== false;
  // The status line is a live SIBLING of the rows, not a child of role="list" (a list
  // may only own listitems).
  const status = loading ? labels.loading : !hasRows ? (total === 0 ? labels.empty : labels.noMatch) : null;
  return (
    <div id={id} className={['bf-history', className].filter(Boolean).join(' ')}>
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
  onDelete, deleting = false, extraActions, labels: overrides, className,
}: ChatHistoryRowProps) {
  const labels = { ...DEFAULT_CHAT_HISTORY_LABELS, ...overrides };
  const submitRename = () => onSubmitRename?.(chat.id, renameValue);
  const hasActions = Boolean(onStartRename || onSummarize || onDelete || extraActions);
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
            <span className="bf-chatrow__title">
              {chatSwitcherLabel({ title: chat.title, id: chat.id, ticketCount: chat.ticketCount, ticketProgressPct: chat.ticketProgressPct })}
            </span>
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
