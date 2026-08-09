import type { CSSProperties } from 'react';

/**
 * Shared presentation tokens for the three Agent Ops panels.
 *
 * Extracted rather than repeated per panel: the same card, the same table, the same
 * empty state and the same chip appear in all three, and a copy in each would drift on
 * the first theme change. Every value resolves a CSS variable, so light and dark are
 * both covered by construction; sizes are fluid (minmax / % / clamp) so nothing
 * overflows a 360px viewport.
 */

export const card: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'clamp(12px, 3vw, 18px)',
};

export const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
  gap: 12,
};

export const sectionTitle: CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 700,
  margin: '0 0 8px',
  color: 'var(--text-primary)',
};

export const muted: CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--text-secondary)',
  margin: 0,
};

export const mono: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  wordBreak: 'break-all',
};

/** Wide tables scroll INSIDE their own container — the page body never scrolls sideways. */
export const tableScroll: CSSProperties = { overflowX: 'auto', width: '100%' };

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.85rem',
  minWidth: 520,
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle, var(--border))',
  color: 'var(--text-primary)',
  verticalAlign: 'top',
};

/** Small status/scope pill. `tone` picks a semantic accent; all are theme variables. */
export function chip(tone: 'neutral' | 'accent' | 'warn' | 'good' = 'neutral'): CSSProperties {
  const palette: Record<typeof tone, { bg: string; fg: string }> = {
    neutral: { bg: 'var(--bg-elevated)', fg: 'var(--text-secondary)' },
    accent: { bg: 'var(--accent-subtle, var(--bg-elevated))', fg: 'var(--accent)' },
    warn: { bg: 'var(--warning-subtle, var(--bg-elevated))', fg: 'var(--warning)' },
    good: { bg: 'var(--success-subtle, var(--bg-elevated))', fg: 'var(--success, var(--success))' },
  };
  const { bg, fg } = palette[tone];
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 'var(--radius-full)',
    fontSize: '0.72rem',
    fontWeight: 600,
    background: bg,
    color: fg,
    whiteSpace: 'nowrap',
  };
}

/** Tap-friendly button. `kind:'danger'` for destructive actions. */
export function button(kind: 'primary' | 'ghost' | 'danger' = 'ghost'): CSSProperties {
  const base: CSSProperties = {
    minHeight: 40,
    padding: '8px 14px',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
  };
  if (kind === 'primary') {
    return { ...base, background: 'var(--accent)', color: 'var(--text-on-accent)', borderColor: 'transparent' };
  }
  if (kind === 'danger') {
    return { ...base, color: 'var(--danger)', borderColor: 'var(--danger)' };
  }
  return base;
}

/** Inputs and selects. A native <option> needs its OWN opaque background/foreground,
 *  or a dark-theme dropdown renders unreadable on some platforms. */
export const input: CSSProperties = {
  minHeight: 40,
  padding: '8px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  width: '100%',
  maxWidth: '100%',
};

export const option: CSSProperties = {
  background: 'var(--surface)',
  color: 'var(--text-primary)',
};

export const emptyState: CSSProperties = {
  ...card,
  textAlign: 'center',
  color: 'var(--text-secondary)',
  fontSize: '0.88rem',
  padding: 'clamp(20px, 6vw, 36px)',
};
