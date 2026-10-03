// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { CSSProperties, ReactNode } from 'react';

/**
 * One layer of a stacked pane: every layer stays mounted (so an editor keeps its
 * buffer and a preview keeps its iframe), and only the active one is visible
 * and clickable. The parent must be `position: relative`.
 */
export function PaneLayer({ active, style, children }: { active: boolean; style?: CSSProperties; children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, visibility: active ? 'visible' : 'hidden', pointerEvents: active ? 'auto' : 'none', ...style }}>
      {children}
    </div>
  );
}
