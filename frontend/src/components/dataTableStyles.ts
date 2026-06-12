import type { CSSProperties } from 'react';

/**
 * Shared chrome for the "List" (table) view used alongside card grids.
 * Mirrors the original Projects table so every page's list view looks identical.
 * Columns differ per page; only the surrounding chrome is shared here.
 */
export const tableWrapStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  // Scroll horizontally instead of clipping so wide tables stay usable on
  // narrow / mobile viewports. overflowX:auto forces overflowY to a non-visible
  // value, so pin it to hidden to keep the rounded corners clipped vertically.
  overflowX: 'auto',
  overflowY: 'hidden',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
};

export const theadRowStyle: CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'left',
};

export const thStyle: CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
};

export const trStyle: CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
};

export const tdStyle: CSSProperties = {
  padding: '12px 16px',
  color: 'var(--text-primary)',
};

export const tdMutedStyle: CSSProperties = {
  padding: '12px 16px',
  color: 'var(--text-secondary)',
};
