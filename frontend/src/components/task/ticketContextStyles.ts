import type { CSSProperties } from 'react';

/**
 * The shared chrome of the ticket drawer's context strip — the card, the eyebrow
 * label and the inline link-button — so the strip and the cards it mounts
 * (`TicketObjectiveLinkPicker`) render as ONE surface instead of two copies of the
 * same styles drifting apart. Theme tokens only.
 */

export const contextCard: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 12,
  background: 'var(--bg-elevated)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
};

export const contextLabel: CSSProperties = {
  fontSize: 'var(--font-size-field-label)',
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

export const contextLinkButton: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--coral-bright)',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
};
