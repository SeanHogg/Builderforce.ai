/**
 * The two Insights-operations cards share one card and one input look (tokens
 * only, both themes, 44 px targets). Inline style objects, the admin panels'
 * convention.
 */
import type { CSSProperties } from 'react';

export const insightsOpsCardStyle: CSSProperties = {
  padding: 16,
  minWidth: 0,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--surface-card)',
};

export const insightsOpsInputStyle: CSSProperties = {
  minHeight: 44,
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 13,
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};
