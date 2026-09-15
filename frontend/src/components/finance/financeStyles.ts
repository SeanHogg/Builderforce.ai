/**
 * The finance destination's style objects — the investor surface's kit,
 * re-hued for the CFO. Everything but the accent is the same object, because
 * two destinations that draw "a card" differently stop looking like one product.
 *
 * No `'use client'`: a data module.
 */
import type { CSSProperties } from 'react';
import { buttonStyle } from '@/components/investor/investorStyles';

export {
  cardStyle, emptyStyle, errorStyle, gapChipStyle, labelStyle, listRowStyle, listStyle, mutedStyle, rowStyle, sectionStyle, buttonStyle,
} from '@/components/investor/investorStyles';

export const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--seat-cfo)',
  borderColor: 'var(--seat-cfo)',
  color: 'var(--text-on-accent)',
};

/** A wide table's scroll container — horizontal scroll is intended here and only here. */
export const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 560,
  borderCollapse: 'collapse',
  fontSize: 'var(--font-size-small)',
};

export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 'var(--font-size-eyebrow)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken)',
  whiteSpace: 'nowrap',
};

export const tdStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
};
