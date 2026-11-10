/**
 * WebGL context loss (PRD 43 B3): browsers cap live WebGL contexts and VS Code runs many webviews, so a stage's context
 * can be taken away. Keep it restorable (`preventDefault` on loss) and, when it comes back, rebuild from the last inputs
 * (`StageRenderer.restore`) and ask for a frame. Bound to the canvas element; returns the unbind.
 */

import type { StageRenderer } from './renderer';
import { now } from './tween';

export function bindContextLoss(canvas: HTMLCanvasElement, renderer: Pick<StageRenderer, 'restore'>, invalidate: () => void): () => void {
    const lost = (e: Event) => e.preventDefault();
    const restored = () => { renderer.restore(now()); invalidate(); };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
    };
}
