/**
 * The derivations the view's chrome needs, so `KnowledgeGraphView` stays a composition: where the
 * layout reflows (`layoutOf`), the spine's crumbs and what a crumb does, the Act scope's name, the
 * path strip's title and the props of the scene overlay. Everything is read from the graph's and
 * the surface's state it is handed; it holds no state of its own.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { labelFor, pathOf } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { SurfaceLayout } from '../layout';
import type { LensDef } from '../lenses';
import type { LensId, ViewMode } from '../types';
import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import { buildSpine, withLineCrumb, withSystemCrumb, type SpineItem } from './path';
import { isMultiSystem, systemName } from './systems';
import { entryRoute } from './pathNotes';
import type { QuestionId } from './questions';
import type { CameraDef } from './registry';
import type { SceneOverlayProps } from './SceneOverlay';
import type { MapCap, ScaleLineProps } from './ScaleLine';
import { fileRefOf, stationOfRef } from './stations';
import type { HierarchyView } from '../stage/overlay/CodeHierarchy';
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
    hierarchy?: HierarchyView | undefined;
}

export function useSurfaceChrome(i: SurfaceChromeInput) {
    const { kg, surface, graph, labels, layout, index } = i;
    const s = labels.surface;
    const selected = kg.selected;

    const spineStation = surface.station ?? (selected ? surface.stations.byId.get(stationOfRef(surface.stations, selected) ?? '') ?? null : null);
    const lineLabel = surface.line ? fillTemplate(s.lineName, { name: surface.line.name }) : null;
    // The spine gains the drawn line between the folder and the station; picking it steps back up to the line.
    // A root of several systems starts the crumb at the system the line or station is in.
    const systemCrumb = isMultiSystem(surface.lines.systems) ? systemName(surface.lines.systems, spineStation?.system ?? surface.line?.system) : undefined;
    const rootTitle = i.titleOf(graph.scope.rootId);
    const root: SpineItem = { kind: 'root', label: rootTitle };
    const legacySpine = withSystemCrumb(withLineCrumb(
        buildSpine({ rootTitle: i.titleOf(graph.scope.rootId), station: spineStation, node: selected ? index.get(selected) ?? null : null, nodeLabel: (r) => labelFor(index, r) }),
        surface.pinned ? null : lineLabel,
    ), systemCrumb === rootTitle ? undefined : systemCrumb);
    let spineItems = legacySpine;
    const drill = surface.drill;
    if (i.hierarchy === 'architecture') {
        const component = surface.stations.byId.get(drill.stack[0]?.ref ?? '') ?? spineStation;
        const system = systemName(surface.lines.systems, component?.system);
        const app = component?.app?.split('/').at(-1);
        spineItems = [root];
        if (system && system !== rootTitle) spineItems.push({ kind: 'system', label: system });
        if (app && app !== system && app !== rootTitle && app !== component?.name) spineItems.push({ kind: 'system', id: component?.app ?? app, label: app });
        for (const [depth, frame] of drill.stack.entries()) spineItems.push({ kind: 'level', id: frame.ref, label: frame.name, depth: depth + 1 });
        const member = drill.view?.stations.byId.get(drill.selected ?? '') ?? (!drill.view ? component : null);
        if (member && !drill.stack.some((frame) => frame.ref === member.id)) spineItems.push({ kind: 'station', id: member.id, label: member.name });
    } else if (i.hierarchy === 'filesystem') {
        const ref = selected ?? drill.view?.stations.byId.get(drill.selected ?? '')?.refs[0] ?? spineStation?.refs[0];
        spineItems = [root];
        if (ref) {
            const file = fileRefOf(ref), parts = pathOf(file)?.replaceAll('\\', '/').split('/').filter(Boolean) ?? [];
            const name = parts.pop() ?? labelFor(index, file);
            for (const [depth, part] of parts.entries()) spineItems.push({ kind: 'folder', id: parts.slice(0, depth + 1).join('/'), label: part });
            spineItems.push({ kind: 'file', id: file, label: name });
            if (ref !== file) spineItems.push({ kind: 'symbol', id: ref, label: labelFor(index, ref) });
        }
    }
    const onSpinePick = (item: SpineItem) => {
        if (i.hierarchy) {
            if (item.kind === 'root' || item.kind === 'system') {
                drill.climb(0); kg.select(null); surface.selectStation(null);
            } else if (item.kind === 'level') {
                kg.select(null); drill.select(null); drill.climb(item.depth ?? 0);
            } else if (item.kind === 'station' && item.id) {
                if (drill.view) drill.select(item.id); else surface.selectStation(item.id);
            } else if (item.id && item.kind !== 'folder') i.select(item.id);
            return;
        }
        if (item.kind === 'root') { kg.select(null); surface.selectStation(null); } else if (item.kind === 'line' || item.kind === 'system') surface.selectStation(null);
        else if (item.kind === 'station') kg.select(null); else if (item.id) i.select(item.id);
    };

    const scopeName = surface.station ? surface.station.name : surface.lineChosen ? lineLabel : null;
    const lineName = surface.pinned ? null : surface.line?.name ?? null;
    // The route the line enters by ("GET /users"); a line with no route is titled by its own name, never "X line · X".
    const entry = entryRoute(graph, surface.stations.byId.get(surface.path.stops[0]?.id ?? ''));
    const named = lineName ? fillTemplate(s.lineName, { name: lineName }) : null;
    const pathTitle = named ? (entry && entry !== lineName ? fillTemplate(s.path.title, { line: named, entry }) : named) : null;
    const truncated = graph.stats.truncated || i.visibleNodes < graph.nodes.length;

    // A graph the server cut with no outline (an older server) is drawn from its few files: the scale card says so.
    const source = surface.coverage?.source;
    const mapCap: MapCap | undefined = source?.kind === 'cut' ? { shown: source.files, total: source.sources, cut: true } : surface.stations.capped;

    // The header's Out button: inside a drilled level it goes up one level; otherwise it leaves the picked station for the line.
    // The drill is the transit map's: other cameras keep the station-to-line "Out".
    const drilled = surface.drill.canOut && (i.mode === 'transit' || !!i.hierarchy);
    const out = {
        to: drilled ? surface.drill.parent?.name ?? s.map.world : surface.station ? lineLabel : null,
        onOut: drilled ? surface.drill.out : () => surface.selectStation(null),
    };
    const overlayProps: SceneOverlayProps = {
        labels, cameras: i.cameras, mode: i.mode, onMode: i.setMode, narrow: layout.phone,
        stations: surface.stations.stations, question: surface.question, onQuestion: i.pickQuestion, lenses: kg.lenses, lens: i.lens.id, onLens: i.pickLens,
        family: surface.family, onClearFamily: () => surface.setFamily(null),
    };
    // The scale sentence: the stage draws it under its Colour-by legend (`StageHost`'s `scale`).
    const scaleProps: ScaleLineProps = {
        labels, stats: graph.stats, truncated, compact: layout.compact, showAll: i.showAll, drawn: i.visibleNodes, total: graph.nodes.length, onShowAll: () => i.setShowAll(true), capped: mapCap,
        stations: surface.stations.stations.length, files: graph.stats.sources,
    };
    return { layout, out, spineItems, onSpinePick, scopeName, pathTitle, truncated, overlayProps, scaleProps, askName: surface.station?.name ?? surface.line?.name ?? i.titleOf(graph.scope.rootId) };
}
