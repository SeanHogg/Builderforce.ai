// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { CSSProperties, ReactNode } from 'react';

/**
 * One layer of a stacked pane: every layer stays mounted (so an editor keeps its
 * buffer and a preview keeps its iframe), and only the active one is visible
 * and clickable. The parent must be `position: relative`.
 *
 * The ACTIVE layer asserts nothing: `visibility` and `pointer-events` are inherited, and an
 * explicit `visible`/`auto` here would beat an ancestor that hid the whole workspace. That
 * is exactly how a hidden canvas board (`CanvasStage` keeps every opened board mounted
 * under `visibility:hidden`) painted its App preview over the board actually on stage.
 */
export function PaneLayer({ active, style, children }: { active: boolean; style?: CSSProperties; children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, ...(active ? {} : { visibility: 'hidden', pointerEvents: 'none' }), ...style }}>
      {children}
    </div>
  );
}
