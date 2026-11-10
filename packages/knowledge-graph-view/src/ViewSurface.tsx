/**
 * The main surface of the view: the ONE renderer for the active camera. The cameras are a registry
 * (`surface/cameras.tsx`): every camera that names a placement is drawn by the ONE stage host (a lazy chunk: three.js),
 * mounted at the same place for all of them so a camera switch is a placement swap on the same marks (PRD 43 B1a); the
 * List is the DOM camera and the stage's no-WebGL fallback. This dispatcher names none of them.
 */

import { lazy, Suspense } from 'react';
import { CAMERAS } from './surface/cameras';
import { LayingOut } from './surface/LayingOut';
import type { CameraDef, SceneProps } from './surface/registry';
import { SurfaceErrorBoundary } from './surface/SurfaceErrorBoundary';

export type ViewSurfaceProps = SceneProps;

const StageHost = lazy(() => import('./stage/host/StageHost'));

/** The DOM camera a stage camera falls back to (the List). */
const FALLBACK = CAMERAS.find((c) => c.fallback)!;

export function ViewSurface(p: ViewSurfaceProps) {
    const camera: CameraDef = CAMERAS.find((c) => c.id === p.mode) ?? CAMERAS.find((c) => c.id === 'graph')!;
    // A camera that throws shows the boundary, never a blank host; another camera, root or drill level draws afresh.
    const { drill } = p.surface;
    return (
        <SurfaceErrorBoundary labels={p.labels} resetKey={`${camera.id}\0${p.graph.scope.rootId}\0${drill.stack.length}`} onBack={drill.canOut ? drill.out : undefined}>
            {camera.placement
                ? (
                    <Suspense fallback={<LayingOut labels={p.labels} />}>
                        <StageHost {...p} camera={camera.placement} fallback={FALLBACK.component!} />
                    </Suspense>
                )
                : <camera.component {...p} />}
        </SurfaceErrorBoundary>
    );
}
