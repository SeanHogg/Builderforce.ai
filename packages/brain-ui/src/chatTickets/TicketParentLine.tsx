/**
 * TicketParentLine — the one line on a ticket chip that says WHICH work item the
 * ticket belongs to ("↳ in Advisor Platform").
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * A Brain chat that spawned an epic, a research epic, three child epics and their
 * tasks rendered every one of them as the same flat chip — "EPIC · BACKLOG ·
 * SPAWNED HERE" — so the hierarchy the conversation had just created was invisible
 * in the rail. The parent is the missing fact, and it belongs beside the ticket it
 * qualifies, not in a separate tree view.
 *
 * Self-contained on purpose: it renders NOTHING (returns null) when there is no
 * parent, so the panel never grows a `hasParent` branch of its own. The parent's
 * title is ellipsised (the chip's text column is only 160px wide) with the full
 * title on `title=`, and it becomes a link only when the host both routes tickets
 * AND the parent is genuinely openable — see {@link TicketParentLineProps.onOpen}.
 */
import { V } from './tokens';
import type { TicketParentVM } from './types';

export interface TicketParentLineProps {
  /** The parent work item, or null/undefined for a top-level ticket (renders nothing). */
  parent?: TicketParentVM | null;
  /** Localized "in {parent}" — the host owns the preposition, not just the noun. */
  inParent: (parent: string) => string;
  /**
   * Open the parent in its own view. Passed ONLY when the host routes tickets and
   * the parent is genuinely addressable (the panel hands this down when the parent
   * is itself one of the chat's linked tickets, so a real link VM exists to route —
   * no invented health row). Absent ⇒ the line is plain text, which is the correct
   * rendering for a parent this chat is not linked to.
   */
  onOpen?: () => void;
  /** Accessible name / tooltip for the link form (the host's "Open" verb). */
  openTitle?: string;
}

export function TicketParentLine({ parent, inParent, onOpen, openTitle }: TicketParentLineProps) {
  if (!parent) return null;
  const text = inParent(parent.label);
  return (
    <span style={S.row} title={text}>
      <span aria-hidden style={S.arrow}>↳</span>
      {onOpen ? (
        <button type="button" onClick={onOpen} title={openTitle ? `${openTitle} · ${parent.label}` : text} style={S.link}>{text}</button>
      ) : (
        <span style={S.text}>{text}</span>
      )}
    </span>
  );
}

/** Sentence-case, muted and one line — a qualifier under the chip's meta row, never
 *  competing with the ticket's own label. Colours come from the rail's ONE palette
 *  (tokens.ts), so the line is legible in both the web app's and the editor's themes. */
const S = {
  row: { display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0, maxWidth: '100%' } as React.CSSProperties,
  arrow: { fontSize: 9, color: V.muted, flex: '0 0 auto' } as React.CSSProperties,
  // `minWidth: 0` on the flex ITEM is what actually lets it shrink and ellipsise —
  // without it a long epic title blows the chip's 160px text column wide open.
  text: { fontSize: 10, color: V.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  link: {
    fontSize: 10, color: V.muted, background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
    cursor: 'pointer', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    textDecoration: 'underline', textUnderlineOffset: 2,
  } as React.CSSProperties,
};
