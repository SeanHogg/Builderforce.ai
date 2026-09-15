/**
 * The listing wizard's field kit — the investor surface's tokens, plus the two
 * shapes a form needs that a list does not. Data module; no hooks.
 */
import type { CSSProperties } from 'react';
import { inputStyle, labelStyle } from '@/components/investor/investorStyles';

export { inputStyle, labelStyle };

export const fieldGridStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
};

export const hintStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-eyebrow)',
  color: 'var(--text-muted)',
  marginTop: 4,
};

export const textareaStyle: CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 96 };

export const checkRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};
