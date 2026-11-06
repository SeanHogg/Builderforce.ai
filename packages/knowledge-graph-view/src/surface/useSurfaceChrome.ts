/**
 * The derivations the view's chrome needs, so `KnowledgeGraphView` stays a composition: where the
 * layout reflows (`layoutOf`), the spine's crumbs and what a crumb does, the Act scope's name, the
 * path strip's title and the props of the scene overlay. Everything is read from the graph's and
 * the surface's state it is handed; it holds no state of its own.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { labelFor } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { SurfaceLayout } from '../layout';
import type { LensDef } from '../lenses';
import type { LensId, SyncStatus, ViewMode } from '../types';
import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import { buildSpine, type SpineItem } from './path';
import { entryLabel } from './pathNotes';
import type { QuestionId } from './questions';
import type { CameraDef } from './registry';
import type { SceneOverlayProps } from './SceneOverlay';
import { syncGap } from './drawers/syncModel';
import { stationOfRef } from './stations';
import type { SurfaceModel } from './useSurface';
import type { ZoomApi } from './zoom';

export interface SurfaceChromeInput {
    kg: KnowledgeGraphState;
    surface: SurfaceModel;
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    layout: SurfaceLayout;
    index: ReadonlyMap<string, KNode>;
    titleOf(rootId: string): string;
    select(ref: string): void;
    // The scene overlay.
    cameras: readonly CameraDef[];
    mode: ViewMode;
    setMode(mode: ViewMode): void;
    zoom: ZoomApi | null;
    pickQuestion(id: QuestionId): void;
    pickLens(id: LensId): void;
    lens: LensDef;
    visibleNodes: number;
    showAll: boolean;
    setShowAll(on: boolean): void;
    sync: SyncStatus | null;
}

export function useSurfaceChrome(i: SurfaceChromeInput) {
    const { kg, surface, graph, labels, layout, index } = i;
    const s = labels.surface;
    const selected = kg.selected;

    const spineStation = surface.station ?? (selected ? surface.stations.byId.get(stationOfRef(surface.stations, selected) ?? '') ?? null : null);
    const spineItems = buildSpine({
        rootTitle: i.titleOf(graph.scope.rootId), station: spineStation, node: selected ? index.get(selected) ?? null : null, nodeLabel: (r) => labelFor(index, r),
    });
    const onSpinePick = (item: SpineItem) => {
        if (item.kind === 'root') { kg.select(null); surface.selectStation(null); } else if (item.kind === 'station') kg.select(null); else if (item.id) i.select(item.id);
    };

    const lineLabel = surface.line ? fillTemplate(s.lineName, { name: surface.line.name }) : null;
    const scopeName = surface.station ? surface.station.name : surface.lineChosen ? lineLabel : null;
    const lineName = surface.pinned ? null : surface.line?.name ?? null;
    const entry = entryLabel(graph, surface.stations.byId.get(surface.path.stops[0]?.id ?? ''));
    const pathTitle = lineName ? fillTemplate(s.path.title, { line: fillTemplate(s.lineName, { name: lineName }), entry }) : null;
    const truncated = graph.stats.truncated || i.visibleNodes < graph.nodes.length;

    const gap = syncGap(i.sync); // ONE reading: the banner's two numbers cannot disagree
    const drilled = surface.drill.canOut && i.mode === 'transit';
    const overlayProps: SceneOverlayProps = {
        labels, cameras: i.cameras, mode: i.mode, onMode: i.setMode, zoom: i.zoom, narrow: layout.phone,
        // Inside a drilled level "Out" goes up one level; otherwise it leaves the picked station for the line.
        // The drill is the transit map's: other cameras keep the station-to-line "Out".
        outTo: drilled ? surface.drill.parent?.name ?? s.map.world : surface.station ? lineLabel : null,
        onOut: drilled ? surface.drill.out : () => surface.selectStation(null),
        stations: surface.stations.stations, question: surface.question, onQuestion: i.pickQuestion, lenses: kg.lenses, lens: i.lens.id, onLens: i.pickLens,
        family: surface.family, onClearFamily: () => surface.setFamily(null),
        stats: graph.stats, truncated, compact: layout.compact, showAll: i.showAll, drawn: i.visibleNodes, total: graph.nodes.length, onShowAll: () => i.setShowAll(true), capped: surface.stations.capped,
        missingFiles: gap.missing, tooLarge: gap.tooLarge, onDiagnose: () => surface.openPanel('sync'),
    };
    return { layout, spineItems, onSpinePick, scopeName, pathTitle, truncated, overlayProps, askName: surface.station?.name ?? surface.line?.name ?? i.titleOf(graph.scope.rootId) };
}
