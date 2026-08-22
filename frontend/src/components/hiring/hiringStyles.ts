/**
 * The hiring surface's shared style objects.
 *
 * Extracted rather than repeated per component: five surfaces drawing "a card" with five
 * slightly different paddings is how a destination stops looking like one destination.
 * Tokens only — a raw hex here would be a single-theme colour, and the design-token guard
 * exists because that failure is invisible in whichever theme the author had open.
 *
 * No `'use client'`: this is a data module with no hooks, pulled into the client bundle by
 * whoever imports it.
 */
import type { CSSProperties } from 'react';

export const cardStyle: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 14,
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

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

export const buttonStyle: CSSProperties = {
  padding: '7px 12px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
};

export const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--accent)',
  borderColor: 'var(--accent)',
  color: 'var(--text-on-accent)',
};

export const mutedStyle: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
};

/** A stage chip. One shape for every stage, including the ones a tenant invented — a
 *  per-stage colour table would go stale the first time somebody renamed one. */
export const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  whiteSpace: 'nowrap',
};

/**
 * A candidate's identity when the résumé projection has no headline.
 *
 * The ref is a party ref (a uuid), so it is shortened rather than shown whole: a column
 * of 36-character ids is unreadable, and the drawer shows the full one.
 */
export function candidateLabel(headline: string | null, candidateRef: string): string {
  return headline?.trim() || `${candidateRef.slice(0, 8)}…`;
}
