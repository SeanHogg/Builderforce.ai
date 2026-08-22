/**
 * The drawer's own chrome, in one place.
 *
 * These four objects were declared at module scope in `ProjectDetailsPanel.tsx`
 * and read by the header, the tab strip and three of the tab bodies — so every
 * one of those had to live in that file to reach them. Naming them here is what
 * lets each tab be its own component.
 */
import type { CSSProperties } from 'react';

export const panelOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9998,
};

export const panelDrawerStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: '85%',
  maxWidth: '100%',
  borderLeft: '1px solid var(--border-subtle)',
  boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
};

export const cardStyle: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

/** The grid every multi-card tab body lays its cards out on. */
export const tabGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 16,
};
