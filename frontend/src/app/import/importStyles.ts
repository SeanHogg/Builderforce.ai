import type { CSSProperties } from 'react';

/**
 * The handful of inline styles the import screens share. Buttons, fields and
 * cards come from `@/components/ui`; what is left here is typography and table
 * cells, declared once so the guided and bulk halves cannot drift. Tokens only.
 */

export const h2Style: CSSProperties = {
  fontSize: 'var(--font-size-section)',
  fontWeight: 700,
  margin: '0 0 var(--space-4)',
  color: 'var(--text-primary)',
};

export const bodyText: CSSProperties = {
  fontSize: 'var(--font-size-body)',
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  margin: '0 0 var(--space-5)',
};

export const smallText: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
  margin: 0,
};

export const dangerText: CSSProperties = {
  color: 'var(--danger)',
};

export const errorBanner: CSSProperties = {
  color: 'var(--danger-text)',
  background: 'var(--danger-bg)',
  border: '1px solid var(--danger-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--font-size-body)',
  marginTop: 'var(--space-3)',
};

/** Back on the left, cancel + next on the right; wraps on a phone. */
export const buttonRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
  marginTop: 'var(--space-6)',
};

export const buttonCluster: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
};

/** A wide table scrolls inside its own box; the page never scrolls sideways. */
export const tableWrap: CSSProperties = {
  overflowX: 'auto',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--font-size-body)',
};

export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: 'var(--space-2) var(--space-3)',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

export const tdStyle: CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: 'var(--font-size-body)',
  color: 'var(--text-primary)',
  verticalAlign: 'middle',
};

/** Native <option> paints the OS default palette unless told otherwise — an
 *  opaque background and foreground keep it readable in both themes. */
export const optionStyle: CSSProperties = {
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
};

export const statGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-6)',
};
