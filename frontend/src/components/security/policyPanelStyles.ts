/** Shared inline styles for the governance policy-pack surfaces (theme tokens only, so both modes read). */

import type React from 'react';

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
};

// Native <option> popups are drawn by the OS and do NOT inherit the surface's
// theme tokens — they need their own opaque background/foreground or they render
// as white-on-white in dark mode.
export const optionStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
};

export const primaryButton: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
};
