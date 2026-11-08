import type { CSSProperties } from 'react';

/** The small square/inline button every block row and toolbar shares. */
export const gutterButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-size-eyebrow)',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
