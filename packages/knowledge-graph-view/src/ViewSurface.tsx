/**
 * The main surface of the view: the ONE renderer for the active camera. The cameras are a registry
 * (`surface/cameras.tsx`): every camera that names a placement is drawn by the ONE stage host (a lazy chunk: three.js),
 * mounted at the same place for all of them so a camera switch is a placement swap on the same marks (PRD 43 B1a); the
 * List is the DOM camera and the stage's no-WebGL fallback. This dispatcher names none of them.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { CAMERAS } from './surface/cameras';
import { LayingOut } from './surface/LayingOut';
import type { CameraDef, SceneProps } from './surface/registry';
import { SurfaceErrorBoundary } from './surface/SurfaceErrorBoundary';
import type { StageCodeProps, StageCompareProps, StageFlatProps } from './stage/host/StageHost';

/**
 * The scene's props, plus what the stage host threads to its code pane (visibility, Simulate, Restructure), the open comparison, the 3D / Flat switch and
 * the scale sentence (`scale`, drawn by the stage under its Colour-by legend; a DOM camera draws none).
 */
export type ViewSurfaceProps = SceneProps & StageCodeProps & StageCompareProps & StageFlatProps & { scale?: ReactNode };

const StageHost = lazy(() => import('./stage/host/StageHost'));

/** The DOM camera a stage camera falls back to (the List). */
const FALLBACK = CAMERAS.find((c) => c.fallback)!;

export function ViewSurface({ scale, ...p }: ViewSurfaceProps) {
    const camera: CameraDef = CAMERAS.find((c) => c.id === p.mode) ?? CAMERAS.find((c) => c.id === 'graph')!;
    // A camera that throws shows the boundary, never a blank host; another camera, root or drill level draws afresh.
    const { drill } = p.surface;
    return (
        <SurfaceErrorBoundary labels={p.labels} resetKey={`${camera.id}\0${p.graph.scope.rootId}\0${drill.stack.length}`} onBack={drill.canOut ? drill.out : undefined}>
            {camera.placement
                ? (
                    <Suspense fallback={<LayingOut labels={p.labels} />}>
                        <StageHost {...p} camera={camera.placement} scale={scale} fallback={FALLBACK.component!} />
                    </Suspense>
                )
                : <camera.component {...p} />}
        </SurfaceErrorBoundary>
    );
}
