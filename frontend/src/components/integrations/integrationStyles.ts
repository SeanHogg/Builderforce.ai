/**
 * Shared theme-token styles for the integrations surfaces (credentials
 * manager, connect form, board connections, gallery panel). One copy — these
 * were re-declared verbatim in each of those files.
 */
import type { CSSProperties } from 'react';

export const panelCard: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};

export const formPanel: CSSProperties = {
  marginTop: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 14,
  background: 'var(--bg-deep)',
  borderRadius: 'var(--radius-lg)',
};

export const inputStyle: CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  width: '100%',
  boxSizing: 'border-box',
};

export const btnPrimary: CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--coral-bright)', color: 'var(--text-on-accent)',
  border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

export const btnSubtle: CSSProperties = {
  padding: '6px 10px', fontSize: 12, fontWeight: 600,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
