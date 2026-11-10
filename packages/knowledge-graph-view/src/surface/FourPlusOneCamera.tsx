/**
 * The 4+1 camera (Kruchten's 4+1 view model): ONE camera holding the four architectural views plus the scenarios,
 * swapped by a `Segmented` switcher. Logical, Development and Process compose the EXISTING System, Mind map and
 * Sequence cameras (no fork); Physical and Scenarios read the systems, termini and lines the other cameras read.
 *
 * Zoom: the HTML views scale with `ScaleZoom`; the Mind map registers its own viewBox pan/zoom, so it is not wrapped
 * (the camera row is not `scaled()` either, or the outer scale would take the overlay's buttons from the map).
 */

import { useMemo, useState, type ComponentType } from 'react';
import type { FourPlusOneView } from '../labels/surface.4plus1';
import { MindMap } from '../map/MindMap';
import { cssVar } from '../scene/themeColors';
import { PhysicalView } from './fourPlusOne/PhysicalView';
import { ScenariosView } from './fourPlusOne/ScenariosView';
import type { SceneProps } from './registry';
import { SequenceDiagram } from './SequenceDiagram';
import { SystemTiers } from './SystemTiers';
import { Segmented } from './ui/Segmented';
import { TYPE } from './ui/type';
import { ScaleZoom } from './zoom';

export const FOUR_PLUS_ONE_VIEWS: readonly FourPlusOneView[] = ['logical', 'development', 'process', 'physical', 'scenarios'];

function DevelopmentView({ graph, labels, rootTitle, selected, focus, onSelect, onShow }: SceneProps) {
    const files = useMemo(() => graph.nodes.filter((n) => n.kind === 'file'), [graph.nodes]);
    return (
        <MindMap
            nodes={files} findings={graph.findings} rootTitle={rootTitle} selected={selected} focus={focus}
            onSelect={onSelect} onShow={onShow} labels={labels} label={labels.surface.fourPlusOne.views.development}
        />
    );
}

const PADDED = { padding: 12 } as const;
function Padded({ View, p }: { View: ComponentType<SceneProps>; p: SceneProps }) {
    return <ScaleZoom><div style={PADDED}><View {...p} /></div></ScaleZoom>;
}

export function FourPlusOneCamera(p: SceneProps) {
    const s = p.labels.surface.fourPlusOne;
    const [view, setView] = useState<FourPlusOneView>('logical');
    const items = useMemo(() => FOUR_PLUS_ONE_VIEWS.map((id) => ({ id, label: s.views[id] })), [s.views]);
    return (
        <div data-testid="kg-4plus1" data-view={view} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', boxSizing: 'border-box', color: cssVar('text') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px 12px', padding: '10px 12px 0', flexWrap: 'wrap' }}>
                <Segmented label={s.viewsLabel} value={view} onChange={(id) => setView(id as FourPlusOneView)} items={items} style={{ maxWidth: '100%', overflowX: 'auto' }} />
                <p style={{ ...TYPE.bodyMuted, margin: 0, flex: '1 1 200px', minWidth: 0 }}>{s.hints[view]}</p>
            </div>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                {view === 'logical' && <ScaleZoom><SystemTiers {...p} /></ScaleZoom>}
                {view === 'development' && <DevelopmentView {...p} />}
                {view === 'process' && <ScaleZoom><SequenceDiagram {...p} /></ScaleZoom>}
                {view === 'physical' && <Padded View={PhysicalView} p={p} />}
                {view === 'scenarios' && <Padded View={ScenariosView} p={p} />}
            </div>
        </div>
    );
}
