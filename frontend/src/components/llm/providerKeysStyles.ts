import type { CSSProperties } from 'react';

/**
 * Shared styles for the BYO provider settings surface — the provider drawers, the
 * precedence list and the model picker render as one family, so they share one set of
 * token-driven styles instead of each re-declaring them. Every colour is a theme token,
 * so both themes are covered.
 */

export const sectionTitle: CSSProperties = {
  fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6,
};

export const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  boxSizing: 'border-box', fontFamily: 'var(--font-mono)', minWidth: 0,
};

export const buttonPrimary: CSSProperties = {
  padding: '6px 12px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--surface-interactive)',
  color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

export const buttonDanger: CSSProperties = {
  padding: '6px 12px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'none',
  color: 'var(--coral-bright)', border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
