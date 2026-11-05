/**
 * The main surface of the view: the ONE renderer for the active camera. The cameras are a
 * registry (`surface/cameras.tsx`): the transit map, the 2D graph, the folder mind map, the
 * lazy 3D tower (a chunk loaded only when WebGL exists) and the list (the accessible text
 * alternative to all of them). This dispatcher names none of them.
 */

import { CAMERAS } from './surface/cameras';
import type { SceneProps } from './surface/registry';

export type ViewSurfaceProps = SceneProps;

export function ViewSurface(p: ViewSurfaceProps) {
    const camera = CAMERAS.find((c) => c.id === p.mode) ?? CAMERAS.find((c) => c.id === 'graph')!;
    const Camera = camera.component;
    return <Camera {...p} />;
}
