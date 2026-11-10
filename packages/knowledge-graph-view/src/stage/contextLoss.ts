/**
 * WebGL context loss (PRD 43 B3): browsers cap live WebGL contexts and VS Code runs many webviews, so a stage's context
 * can be taken away. Keep it restorable (`preventDefault` on loss) and, when it comes back, rebuild from the last inputs
 * (`StageRenderer.restore`) and ask for a frame. A context that is not back within {@link CONTEXT_GIVE_UP_MS} is lost
 * for good: `onGiveUp` tells the host, which falls back to the List (B8 No WebGL). Bound to the canvas element; returns
 * the unbind.
 */

import type { StageRenderer } from './renderer';
import { now } from './tween';

/** How long a lost context may take to come back before the stage gives up on it. */
export const CONTEXT_GIVE_UP_MS = 5000;

export function bindContextLoss(canvas: HTMLCanvasElement, renderer: Pick<StageRenderer, 'restore'>, invalidate: () => void, onGiveUp?: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const lost = (e: Event) => {
        e.preventDefault();
        clear();
        if (onGiveUp) timer = setTimeout(() => { timer = null; onGiveUp(); }, CONTEXT_GIVE_UP_MS);
    };
    const restored = () => { clear(); renderer.restore(now()); invalidate(); };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
        clear();
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
    };
}
