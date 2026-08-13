import type { CSSProperties } from 'react';

/**
 * The Knowledge surface's shared style tokens.
 *
 * They lived in `KnowledgeClient.tsx` and were imported back out of it by
 * `KnowledgeTraining` and `KnowledgeDocClient` — which made the page component a
 * de-facto style module and, worse, closed an import loop: `KnowledgeClient`
 * renders `MyTrainingSection`/`ComplianceAuditSection` from `KnowledgeTraining`,
 * and `KnowledgeTraining` reached back for `badge`. Only render-time reads
 * crossed that loop so it never threw, but it is the same shape as the cycle
 * that took every route down from `aiInsightPanels`, and a leaf module is where
 * shared tokens belonged anyway.
 *
 * Every value is a theme variable, never a literal colour, so both themes are
 * covered by construction.
 */

export const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'inherit',
  minWidth: 180,
  flex: '0 1 auto',
};

export const btnPrimary: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontWeight: 600,
};

export const btnGhost: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

export const chip: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};

export const chipActive: CSSProperties = {
  ...chip,
  background: 'var(--accent)',
  borderColor: 'var(--accent)',
  color: 'var(--text-on-accent)',
};

export const badge: CSSProperties = { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-full)', fontWeight: 600 };

export const tagChip: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-2)',
  color: 'var(--text-muted)',
};

export const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, margin: '14px 0 6px' };

/** A document's publication status, as a background/foreground pair. */
export function statusColor(status: string): { bg: string; fg: string } {
  if (status === 'published') return { bg: 'var(--success-bg)', fg: 'var(--success-text)' };
  if (status === 'archived') return { bg: 'var(--surface-2)', fg: 'var(--text-muted)' };
  return { bg: 'var(--warning-bg)', fg: 'var(--warning-text, var(--amber-bright))' };
}

/** The same pair, spread-ready onto a `<span style={{ ...badge, ... }}>`. */
export function statusColorStyle(status: string): { background: string; color: string } {
  const c = statusColor(status);
  return { background: c.bg, color: c.fg };
}
