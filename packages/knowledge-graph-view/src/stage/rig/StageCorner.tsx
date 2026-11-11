/**
 * The stage's bottom-right corner (PRD 43 B2): the nav control above the depth control, stacked, never overlapping.
 * Anchored to the VIEWPORT like the zoom controls: on a tall `document` frame (Map) the page scrolls past the stage, so
 * the corner rides a zero-height sticky row at the stage's bottom edge and stays at the bottom of whatever part of the
 * stage is on screen. The stage box is a flow root (`display: flow-root`), so the row's top margin stays INSIDE it —
 * as the box's first in-flow child it otherwise collapsed through the box and pushed the whole stage down one box height.
 */

import type { ReactNode } from 'react';

export interface StageCornerProps {
    /** The stage box's height: the sticky row sits at its bottom edge. */
    boxHeight: number;
    children: ReactNode;
}

export function StageCorner({ boxHeight, children }: StageCornerProps) {
    return (
        <div style={{ position: 'sticky', bottom: 0, height: 0, marginTop: boxHeight, zIndex: 1, pointerEvents: 'none' }} data-stage-corner>
            <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'grid', gap: 6, justifyItems: 'end', maxWidth: 'calc(100% - 16px)' }}>
                {children}
            </div>
        </div>
    );
}
