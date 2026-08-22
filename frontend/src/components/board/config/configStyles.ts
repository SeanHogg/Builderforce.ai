/**
 * The board-config panel's four shared control styles.
 *
 * They were module-scoped constants in `BoardConfigPanel.tsx`, read by all four
 * tabs — which is one of the reasons all four tabs had to live in that file.
 */
import type { CSSProperties } from 'react';

export const inputStyle: CSSProperties = {
  padding: '7px 10px',
  fontSize: 'var(--font-size-small)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

export const btnPrimary: CSSProperties = {
  padding: '7px 12px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export const btnSubtle: CSSProperties = {
  padding: '5px 9px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export const sectionPad: CSSProperties = { padding: 20 };
