/**
 * The main surface of the view: the ONE renderer for the active camera. The cameras are a
 * registry (`surface/cameras.tsx`): the transit map, the 2D graph, the folder mind map, the
 * lazy 3D tower (a chunk loaded only when WebGL exists) and the list (the accessible text
 * alternative to all of them). This dispatcher names none of them.
 */

import { lazy, Suspense, useState } from 'react';
import { CAMERAS } from './surface/cameras';
import type { SceneProps } from './surface/registry';
import { SurfaceErrorBoundary } from './surface/SurfaceErrorBoundary';
import { stageSpikeOn } from './stage/spike/flag';

export type ViewSurfaceProps = SceneProps;

/** PRD 43 P1a: the stage spike, a lazy chunk mounted in place of the graph cameras only when a developer opted in (`stage/spike/flag.ts`). */
const StageSpike = lazy(() => import('./stage/spike/StageSpike'));

export function ViewSurface(p: ViewSurfaceProps) {
    const [spike] = useState(stageSpikeOn);
    const camera = CAMERAS.find((c) => c.id === p.mode) ?? CAMERAS.find((c) => c.id === 'graph')!;
    const Camera = spike && (p.mode === 'transit' || p.mode === 'graph') ? SpikeCamera : camera.component;
    // A camera that throws shows the boundary, never a blank host; another camera, root or drill level draws afresh.
    const { drill } = p.surface;
    return (
        <SurfaceErrorBoundary labels={p.labels} resetKey={`${camera.id}\0${p.graph.scope.rootId}\0${drill.stack.length}`} onBack={drill.canOut ? drill.out : undefined}>
            <Camera {...p} />
        </SurfaceErrorBoundary>
    );
}

function SpikeCamera(p: SceneProps) {
    return <Suspense fallback={null}><StageSpike {...p} /></Suspense>;
}
