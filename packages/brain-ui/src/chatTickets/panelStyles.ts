/**
 * The chat-tickets rail's styles — ONE set every part of the rail draws with, CSS-var
 * driven through the rail's palette (`tokens.ts`) so both themes are covered.
 */
import type React from 'react';
import { nativeOptionStyle } from '../optionStyle';
import { V } from './tokens';

// `colorScheme` makes the browser draw the native <select> (and its OS/UA popup)
// in the editor's active scheme even where the token background doesn't reach.
const select: React.CSSProperties = { minWidth: 120, padding: '4px 8px', fontSize: 12, borderRadius: 8, border: `1px solid ${V.border}`, background: V.field, color: V.fieldText, colorScheme: 'inherit' };

/** Ticket card height and the rows the grid shows before it scrolls. */
const TICKET_CHIP_HEIGHT = 64;
const TICKET_GRID_GAP = 12;
const TICKET_GRID_ROWS = 2;

export const S = {
  root: { margin: '4px 0 0', padding: '8px 10px', border: `1px solid ${V.border}`, borderRadius: 10, background: V.surface, display: 'flex', flexDirection: 'column', gap: 8 } as React.CSSProperties,
  muted: { fontSize: 12, color: V.muted } as React.CSSProperties,
  // The chat's ORIGINAL request — read-only historical record (the first prompt,
  // migration 1245), shown as a labelled quote above the linked-ticket grid. Line-
  // clamped so a pasted paragraph cannot push the transcript off-screen; the full
  // text is on the element's title/accessible name.
  originalRequest: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } as React.CSSProperties,
  originalRequestLabel: { fontSize: 10, color: V.muted, textTransform: 'uppercase', letterSpacing: 0.4 } as React.CSSProperties,
  originalRequestText: {
    fontSize: 12, color: V.text, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
    overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' as const, textAlign: 'left' as const,
  } as React.CSSProperties,
  // Collapsible ticket-summary header — full-width, button-reset, subtle hover-less
  // affordance that carries a caret, an overall health ring and the linked count.
  // The header row: ticket health on the left, the sort control on the right. Wraps
  // on a narrow panel rather than pushing the select off the edge.
  headerRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 } as React.CSSProperties,
  // The drawer toggles, wrapping on a narrow panel; the cost pill closes the row on the right.
  actionRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 } as React.CSSProperties,
  ticketsHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px', flex: '1 1 auto', minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: V.text } as React.CSSProperties,
  caret: { display: 'inline-block', fontSize: 11, color: V.muted, transition: 'transform 120ms ease' } as React.CSSProperties,
  ticketsCount: { fontSize: 12, fontWeight: 600, color: V.text } as React.CSSProperties,
  ticketsAgg: { fontSize: 11, color: V.muted } as React.CSSProperties,
  // Expanded ring grid — a chat can link hundreds of tickets, so the grid shows TWO rows of
  // cards and scrolls the rest, keeping the transcript in view below it. The cards have a
  // fixed height so "two rows" is exact whatever a card holds.
  ticketGrid: { display: 'flex', alignItems: 'center', alignContent: 'flex-start', gap: TICKET_GRID_GAP, flexWrap: 'wrap', maxHeight: TICKET_GRID_ROWS * TICKET_CHIP_HEIGHT + (TICKET_GRID_ROWS - 1) * TICKET_GRID_GAP, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 4 } as React.CSSProperties,
  chip: { display: 'flex', alignItems: 'center', gap: 6, height: TICKET_CHIP_HEIGHT, boxSizing: 'border-box', overflow: 'hidden', padding: '2px 6px', border: `1px solid ${V.border}`, borderRadius: 8 } as React.CSSProperties,
  ticketLabel: { fontSize: 12, fontWeight: 600, color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  // Clickable variant of the label — opens the artifact. Underlined-on-hover link
  // affordance, theme-driven accent, left-aligned and truncating like the span.
  ticketLink: { fontSize: 12, fontWeight: 600, color: V.accent, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textUnderlineOffset: 2 } as React.CSSProperties,
  ticketMeta: { fontSize: 10, color: V.muted, textTransform: 'uppercase', letterSpacing: 0.4 } as React.CSSProperties,
  drawer: { fontSize: 12, color: V.text2, borderTop: `1px dashed ${V.border}`, paddingTop: 6 } as React.CSSProperties,
  section: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px dashed ${V.border}`, paddingTop: 8 } as React.CSSProperties,
  agentChip: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: V.surface2, border: `1px solid ${V.border}`, fontSize: 12, color: V.text } as React.CSSProperties,
  select,
  // Compact sort control in the rail header — sits outside the collapse button so
  // changing the order never toggles the grid. The `select` look, just tighter.
  sortSelect: { ...select, minWidth: 132, maxWidth: 180, padding: '3px 6px', fontSize: 11, flex: '0 0 auto' } as React.CSSProperties,
  // The option popup is drawn by the OS and does NOT inherit `select`'s background,
  // so each option needs its own opaque pair — see nativeOptionStyle.
  option: nativeOptionStyle,
  icon: { fontSize: 12, lineHeight: 1, padding: '2px 4px', cursor: 'pointer', background: 'transparent', border: 'none', color: V.muted } as React.CSSProperties,
  pill: (active: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? V.accent : V.border}`,
    background: active ? V.accent : V.surface2,
    color: active ? '#fff' : V.text2,
  }),
};
