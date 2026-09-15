/**
 * The startup directory's shared style objects — the marketplace card kit,
 * tinted with the CEO's hue. Tokens only, for the same reason `investorStyles`
 * gives: a raw hex is a single-theme colour.
 *
 * No `'use client'`: a data module, pulled into whichever bundle imports it.
 */
import type { CSSProperties } from 'react';

export const startupCardStyle: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  textDecoration: 'none',
  color: 'var(--text-primary)',
  minWidth: 0,
};

export const startupLogoStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-interactive)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  color: 'var(--text-primary)',
  flexShrink: 0,
  overflow: 'hidden',
};

export const startupChipStyle: CSSProperties = {
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
  whiteSpace: 'nowrap',
};

/** A chip a person can press — the stage row above the grid. */
export const startupFilterChipStyle: CSSProperties = {
  ...startupChipStyle,
  minHeight: 32,
  padding: '4px 12px',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
};

export const startupFilterChipActiveStyle: CSSProperties = {
  ...startupFilterChipStyle,
  borderColor: 'var(--seat-ceo)',
  color: 'var(--text-primary)',
  boxShadow: '0 0 0 2px color-mix(in srgb, var(--seat-ceo) 25%, transparent)',
};

export const startupMetricRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
};

export const startupMutedStyle: CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
};

/** The one accent button on a card — the CEO's hue, never coral. */
export const startupPrimaryButtonStyle: CSSProperties = {
  padding: '9px 14px',
  minHeight: 36,
  fontSize: 'var(--font-size-small)',
  fontWeight: 650,
  border: '1px solid var(--seat-ceo)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--seat-ceo)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  width: '100%',
};

export const startupGhostButtonStyle: CSSProperties = {
  ...startupPrimaryButtonStyle,
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border-subtle)',
};

/** Health → tone token. The map lives once so the card, the founder's form and
 *  the CFO's tile cannot colour the same verdict three ways. */
export const runwayHealthTone: Record<string, { ink: string; bg: string }> = {
  critical: { ink: 'var(--error-text)', bg: 'var(--error-bg)' },
  watch: { ink: 'var(--warning-text)', bg: 'var(--warning-bg)' },
  healthy: { ink: 'var(--success-text)', bg: 'var(--success-bg)' },
  profitable: { ink: 'var(--success-text)', bg: 'var(--success-bg)' },
};
