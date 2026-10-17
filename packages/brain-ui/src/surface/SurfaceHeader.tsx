import type { ReactNode } from 'react';
import { BrainMark } from './BrainMark';

/**
 * The ONE header every AI surface wears — extracted from the web Brain panel's docked
 * header and now also the canvas dock, the canvas Chat lens, the VS Code chat and Rovr.
 *
 * One row that never wraps: the mark (breathing while a turn runs) and the name, then
 * the host's context (the only part that shrinks — its chips ellipsize), presence, the
 * host's own actions, then the standard levers — History, New chat, Expand, Close —
 * each offered only when the host supplies its handler or slot (no `canX` flags).
 *
 * Presentational and theme-driven (`--bf-*`, `.bf-shead*` in styles.css).
 */

export interface SurfaceHeaderLabels {
  historyShow: string;
  historyHide: string;
  newChat: string;
  close: string;
}

export const DEFAULT_SURFACE_HEADER_LABELS: SurfaceHeaderLabels = {
  historyShow: 'Chat history',
  historyHide: 'Back to the chat',
  newChat: 'New chat',
  close: 'Close',
};

export interface SurfaceHeaderHistory {
  open: boolean;
  onToggle: () => void;
  /** Unread messages in OTHER chats — badged on the History lever. */
  unread?: number;
  /** id of the element the lever shows/hides. Referenced only while open — the list is
   *  not in the DOM while closed, and aria-controls must not point at a missing id. */
  controls?: string;
}

export interface SurfaceHeaderProps {
  /** The agent's name as this surface calls it (Brain, BuilderForce, Rovr). */
  title: ReactNode;
  /** A turn is in flight — the mark breathes. */
  running?: boolean;
  /** What the agent is working with (chips, a chat picker) — the part that shrinks. */
  context?: ReactNode;
  /** Who else is here (avatars). */
  presence?: ReactNode;
  /** The host's own icon actions, before the standard levers. */
  actions?: ReactNode;
  history?: SurfaceHeaderHistory;
  onNewChat?: () => void;
  /** The expand lever — a host link to its full page (a router link stays the host's). */
  expand?: ReactNode;
  onClose?: () => void;
  labels?: Partial<SurfaceHeaderLabels>;
  className?: string;
}

export function SurfaceHeader({
  title, running = false, context, presence, actions, history, onNewChat, expand, onClose, labels: overrides, className,
}: SurfaceHeaderProps) {
  const labels = { ...DEFAULT_SURFACE_HEADER_LABELS, ...overrides };
  const historyLabel = history?.open ? labels.historyHide : labels.historyShow;
  return (
    <header className={['bf-shead', className].filter(Boolean).join(' ')}>
      <span className="bf-shead__brand">
        <span className="bf-shead__mark"><BrainMark running={running} /></span>
        <span className="bf-shead__title">{title}</span>
      </span>
      <div className="bf-shead__context">{context}</div>
      {presence && <div className="bf-shead__presence">{presence}</div>}
      {actions}
      {history && (
        <span className="bf-shead__badged">
          <button
            type="button"
            className="bf-shead__btn"
            onClick={history.onToggle}
            title={historyLabel}
            aria-label={historyLabel}
            aria-pressed={history.open}
            aria-controls={history.open ? history.controls : undefined}
          >
            <HeaderIcon d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 8v4l3 2" />
          </button>
          {(history.unread ?? 0) > 0 && <span className="bf-shead__badge">{history.unread! > 99 ? '99+' : history.unread}</span>}
        </span>
      )}
      {onNewChat && (
        <button type="button" className="bf-shead__btn" onClick={onNewChat} title={labels.newChat} aria-label={labels.newChat}>
          <HeaderIcon d="M12 5v14M5 12h14" />
        </button>
      )}
      {expand}
      {onClose && (
        <button type="button" className="bf-shead__btn" onClick={onClose} title={labels.close} aria-label={labels.close}>
          <HeaderIcon d="M6 6l12 12M18 6L6 18" />
        </button>
      )}
    </header>
  );
}

/** A header lever's glyph — stroke icons sized off the button, colour inherited. */
export function HeaderIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** The expand glyph, for a host's `expand` link. */
export const EXPAND_ICON_PATH = 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7';
