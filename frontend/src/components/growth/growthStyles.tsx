import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared visual primitives for the Growth tabs (Mailboxes / Audiences / From
 * addresses / Brand / Templates / Campaigns). One copy, because six sibling
 * sections re-implementing the same input/button/list chrome is how they drift
 * out of sync with each other and with dark mode.
 */

export const input: CSSProperties = {
  flex: '1 1 10rem',
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary, var(--bg-elevated))',
  fontSize: 14,
};

/** A native <select> renders its options in the OS popup, which does not inherit
 *  the page's colours — so both the control AND the options need an explicit
 *  opaque pair or the list is unreadable in dark mode. */
export const selectStyle: CSSProperties = { ...input, appearance: 'auto' };
export const optionStyle: CSSProperties = {
  background: 'var(--surface)',
  color: 'var(--text-primary, var(--bg-elevated))',
};

export const button: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary, var(--bg-elevated))',
  fontSize: 14,
  cursor: 'pointer',
  minHeight: 36,
};

export const primary: CSSProperties = {
  ...button,
  background: 'var(--accent)',
  borderColor: 'var(--accent)',
  color: 'var(--text-on-accent)',
};

export const muted: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };
export const listItem: CSSProperties = { padding: '8px 0', borderTop: '1px solid var(--border)' };
export const listReset: CSSProperties = { listStyle: 'none', padding: 0, margin: '10px 0 0' };
export const spread: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };

export function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{children}</div>;
}
