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
  background: 'var(--surface, #ffffff)',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 12,
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
  borderBottom: '1px solid var(--border, #e5e7eb)',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle, var(--border, #e5e7eb))',
  color: 'var(--text-primary)',
  verticalAlign: 'top',
};

/** Small status/scope pill. `tone` picks a semantic accent; all are theme variables. */
export function chip(tone: 'neutral' | 'accent' | 'warn' | 'good' = 'neutral'): CSSProperties {
  const palette: Record<typeof tone, { bg: string; fg: string }> = {
    neutral: { bg: 'var(--bg-elevated, #f3f4f6)', fg: 'var(--text-secondary)' },
    accent: { bg: 'var(--accent-subtle, var(--bg-elevated, #eef2ff))', fg: 'var(--accent, #4f46e5)' },
    warn: { bg: 'var(--warning-subtle, var(--bg-elevated, #fef3c7))', fg: 'var(--warning, #b45309)' },
    good: { bg: 'var(--success-subtle, var(--bg-elevated, #dcfce7))', fg: 'var(--success, #15803d)' },
  };
  const { bg, fg } = palette[tone];
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
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
    borderRadius: 8,
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--border, #e5e7eb)',
    background: 'var(--surface, #ffffff)',
    color: 'var(--text-primary)',
  };
  if (kind === 'primary') {
    return { ...base, background: 'var(--accent, #4f46e5)', color: 'var(--text-on-accent, #ffffff)', borderColor: 'transparent' };
  }
  if (kind === 'danger') {
    return { ...base, color: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' };
  }
  return base;
}

/** Inputs and selects. A native <option> needs its OWN opaque background/foreground,
 *  or a dark-theme dropdown renders unreadable on some platforms. */
export const input: CSSProperties = {
  minHeight: 40,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--surface, #ffffff)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  width: '100%',
  maxWidth: '100%',
};

export const option: CSSProperties = {
  background: 'var(--surface, #ffffff)',
  color: 'var(--text-primary)',
};

export const emptyState: CSSProperties = {
  ...card,
  textAlign: 'center',
  color: 'var(--text-secondary)',
  fontSize: '0.88rem',
  padding: 'clamp(20px, 6vw, 36px)',
};
