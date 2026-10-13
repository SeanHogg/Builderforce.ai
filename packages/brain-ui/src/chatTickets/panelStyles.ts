/**
 * The chat-tickets rail's styles — ONE set every part of the rail draws with, CSS-var
 * driven through the rail's palette (`tokens.ts`) so both themes are covered.
 */
import type React from 'react';
import { nativeOptionStyle } from '../optionStyle';
import { V } from './tokens';

export const S = {
  root: { margin: '4px 0 0', padding: '8px 10px', border: `1px solid ${V.border}`, borderRadius: 10, background: V.surface, display: 'flex', flexDirection: 'column', gap: 8 } as React.CSSProperties,
  muted: { fontSize: 12, color: V.muted } as React.CSSProperties,
  // Collapsible ticket-summary header — full-width, button-reset, subtle hover-less
  // affordance that carries a caret, an overall health ring and the linked count.
  ticketsHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: V.text } as React.CSSProperties,
  caret: { display: 'inline-block', fontSize: 11, color: V.muted, transition: 'transform 120ms ease' } as React.CSSProperties,
  ticketsCount: { fontSize: 12, fontWeight: 600, color: V.text } as React.CSSProperties,
  ticketsAgg: { fontSize: 11, color: V.muted } as React.CSSProperties,
  // Expanded ring grid — a chat can link hundreds of tickets, so the grid is a fixed-height
  // scroll region (capped to the viewport on short panels) rather than growing past the
  // host's clipped container where the rest could never be reached.
  ticketGrid: { display: 'flex', alignItems: 'center', alignContent: 'flex-start', gap: 12, flexWrap: 'wrap', maxHeight: 'min(320px, 45vh)', overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 4 } as React.CSSProperties,
  chip: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', border: `1px solid ${V.border}`, borderRadius: 8 } as React.CSSProperties,
  ticketLabel: { fontSize: 12, fontWeight: 600, color: V.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  // Clickable variant of the label — opens the artifact. Underlined-on-hover link
  // affordance, theme-driven accent, left-aligned and truncating like the span.
  ticketLink: { fontSize: 12, fontWeight: 600, color: V.accent, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textUnderlineOffset: 2 } as React.CSSProperties,
  ticketMeta: { fontSize: 10, color: V.muted, textTransform: 'uppercase', letterSpacing: 0.4 } as React.CSSProperties,
  drawer: { fontSize: 12, color: V.text2, borderTop: `1px dashed ${V.border}`, paddingTop: 6 } as React.CSSProperties,
  section: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px dashed ${V.border}`, paddingTop: 8 } as React.CSSProperties,
  agentChip: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: V.surface2, border: `1px solid ${V.border}`, fontSize: 12, color: V.text } as React.CSSProperties,
  // `colorScheme` makes the browser draw the native <select> (and its OS/UA popup)
  // in the editor's active scheme even where the token background doesn't reach.
  select: { minWidth: 120, padding: '4px 8px', fontSize: 12, borderRadius: 8, border: `1px solid ${V.border}`, background: V.field, color: V.fieldText, colorScheme: 'inherit' } as React.CSSProperties,
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
