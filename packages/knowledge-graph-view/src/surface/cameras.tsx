/**
 * The camera registry: every way the surface draws the graph, as rows. The order here is the order of the switcher.
 * Every camera but the List is a PLACEMENT of the one stage (PRD 43 B1a: one MarkSet, a camera is only a layout), drawn
 * by the stage host; the List is the DOM camera — the accessible text alternative and the no-WebGL fallback. A new
 * camera is one row plus its id in `ViewMode` (and, for a stage camera, its placement in `PLACEMENTS`); `ViewSurface`
 * and the switcher read this array and know no camera by name.
 */

import { ListFallback } from '../ListFallback';
import type { CameraDef, SceneProps } from './registry';
import { hasSourceFiles } from './sourceFiles';
import { hasLayeredCode } from './style/signals';
import { ScaleZoom } from './zoom';

/** The List is HTML: it registers its zoom (+, −, Fit) through CSS scale. */
function ListCamera(p: SceneProps) {
    return (
        <ScaleZoom>
            <ListFallback
                graph={p.graph} nodes={p.drawn.nodes} lens={p.lens} labels={p.labels} selected={p.selected}
                onSelect={p.onSelect} onShow={p.onShow} onCompose={p.onCompose} evidence={p.evidence} onOpenSource={p.onOpenSource}
            />
        </ScaleZoom>
    );
}

/**
 * `switcher: false` keeps a camera registered (the path strip's Enlarge draws it, a host may still ask for it by id)
 * without a button in the scene overlay's View group.
 */
export const CAMERAS: readonly CameraDef[] = [
    { id: 'transit', labelKey: 'viewTransit', placement: 'map', available: (_graph, env) => env.hasLines },
    { id: 'system', labelKey: 'viewSystem', placement: 'system', available: () => true },
    { id: 'graph', labelKey: 'viewGraph', placement: 'graph', available: () => true },
    { id: 'map', labelKey: 'viewMap', placement: 'mind', available: () => true },
    { id: '3d', labelKey: 'view3d', placement: '3d', available: (_graph, env) => env.webgl },
    { id: 'heat', labelKey: 'viewHeat', placement: 'heat', available: () => true },
    // The architecture cameras read the source files only: a graph with none (docs, nothing reviewed) hides them.
    { id: 'style', labelKey: 'viewStyle', placement: 'style', available: (graph) => hasLayeredCode(graph) },
    { id: 'features', labelKey: 'viewFeatures', placement: 'features', available: (graph) => hasSourceFiles(graph) },
    { id: 'sequence', labelKey: 'viewSequence', placement: 'sequence', available: (_graph, env) => env.hasLines, switcher: false },
    { id: 'list', labelKey: 'viewList', component: ListCamera, available: () => true, fallback: true },
];
