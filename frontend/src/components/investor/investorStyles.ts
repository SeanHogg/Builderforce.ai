/**
 * The investor surface's shared style objects.
 *
 * Extracted rather than repeated per sub-view, for the same reason
 * `hiringStyles.ts` is: six sub-views each drawing "a card" with a slightly
 * different padding is how one destination stops looking like one destination.
 *
 * Tokens only. A raw hex here would be a single-theme colour, which is invisible
 * in whichever theme the author had open — the failure `check:design-tokens`
 * exists for.
 *
 * No `'use client'`: this is a data module with no hooks, pulled into the client
 * bundle by whoever imports it.
 */
import type { CSSProperties } from 'react';

export const cardStyle: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 14,
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

export const inputStyle: CSSProperties = {
  padding: '7px 10px',
  fontSize: 'var(--font-size-small)',
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
};

export const mutedStyle: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
};

export const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

export const buttonStyle: CSSProperties = {
  padding: '7px 12px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

export const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--seat-ceo)',
  borderColor: 'var(--seat-ceo)',
  color: 'var(--text-on-accent)',
};

/**
 * A gap's chip — the retention mechanic made visible.
 *
 * Deliberately NOT colour-coded per category: five hues would say "these are
 * five kinds of thing" when the point is that they are one kind of thing (a hole
 * in the raise) owned by five different seats. The seat's NAME carries that,
 * because a name is readable and a hue is a legend nobody has.
 */
export const gapChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-secondary)',
};

export const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

/** One row inside a list — a project, a room, an investor, a gap. */
export const listRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-sunken)',
  flexWrap: 'wrap',
};

/** The message shown where a sub-view genuinely has nothing yet. Never a
 *  placeholder number: an empty raise reads as empty, not as zero-of-zero. */
export const emptyStyle: CSSProperties = {
  ...mutedStyle,
  padding: '18px 12px',
  textAlign: 'center',
  border: '1px dashed var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
};

export const errorStyle: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--danger)',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 10px',
};

/** The one-time credential, and anything else that must be copied verbatim. */
export const tokenStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-small)',
  wordBreak: 'break-all',
  padding: '8px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)',
};

export const message = (error: unknown, fallback: string): string =>
  (error instanceof Error && error.message ? error.message : fallback);
