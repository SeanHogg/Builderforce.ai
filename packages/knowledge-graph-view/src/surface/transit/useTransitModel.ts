/**
 * Everything the transit map derives from its inputs before it draws: the layout and routes
 * (computed off the main thread, in the compute worker, from the worker-built stations and
 * lines), each drawn station's style (once per station), each line's width (once per line), which
 * stations are documents and the routes of what they describe, the line termini and their places
 * (clear of every station mark and of each other), the HTTP walls, and a node index. One memoized
 * bundle, so the map component only draws.
 */

import { useMemo } from 'react';
import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../../graphModel';
import { useComputed } from '../../compute/useComputed';
import { isSmall } from '../../compute/size';
import type { LinesModel } from '../lines';
import type { OverlayModel, StationStyle } from '../overlays';
import type { Station, StationModel } from '../stations';
import type { TransitLayout } from '../transitLayout';
import { routeLines, type HopRoute } from './corridors';
import { describesLinks, docStations } from './docs';
import type { Point } from './geometry';
import type { Box } from './labelPlacement';
import { groupTermini, type TerminusInfo } from './termini';
import { placeTerminus, terminusBox } from './terminusPlace';
import { httpWalls, routeStations, type Wall } from './wall';

export interface PlacedTerminus { info: TerminusInfo; at: Point; from: Point }

/** What the map draws while the worker's layout is still on its way: no bands, no stations, no routes. */
const EMPTY_LAYOUT: TransitLayout = {
    width: 0, height: 0, bands: [], positions: new Map(), drawn: [], routes: [], bandIndex: new Map(), hiddenOnLine: 0,
};

export interface TransitModel {
    /** The layout the map draws; an empty placeholder until the worker's answer lands (the view shows LayingOut). */
    layout: TransitLayout;
    /** True while the worker's layout is still on its way (the view shows its laying-out state). */
    layoutPending: boolean;
    index: ReadonlyMap<string, KNode>;
    findings: ReadonlyMap<string, Finding>;
    /** The drawn stations, in draw order. */
    drawn: Station[];
    styles: ReadonlyMap<string, StationStyle>;
    /** Line id → its drawn width. */
    widths: ReadonlyMap<string, number>;
    docs: ReadonlySet<string>;
    /** The routes of the dashed "describes" links, round the stations like a line. */
    describes: HopRoute[];
    termini: PlacedTerminus[];
    obstacles: Box[];
    walls: Wall[];
}

export interface TransitModelInput {
    graph: KnowledgeGraph | null;
    stations: StationModel;
    lines: LinesModel;
    overlay: OverlayModel;
    width: number;
    order?: readonly string[] | undefined;
}

export function useTransitModel({ graph, stations, lines, overlay, width, order }: TransitModelInput): TransitModel {
    // The layout is a pure function of the worker-produced stations and lines: computed off the main thread for a big
    // graph, inline for a small one (the gate requires small surfaces to paint complete on their first frame).
    const { value: computed, pending } = useComputed<'transitLayout'>(
        'transitLayout',
        { stations, lines, width, order },
        [stations, lines, width, order],
        null,
        { inline: !graph || isSmall(graph) },
    );
    const layout = computed?.layout ?? EMPTY_LAYOUT;
    // The worker's answer is in flight until the first non-null value lands (the view shows LayingOut).
    const layoutPending = computed === null || pending;
    const index = useMemo(() => (graph ? nodeIndex(graph) : new Map<string, KNode>()), [graph]);
    const findings = useMemo(() => new Map((graph?.findings ?? []).map((f) => [f.id, f] as const)), [graph]);
    const drawn = useMemo(() => layout.drawn.flatMap((id) => stations.byId.get(id) ?? []), [layout, stations.byId]);
    const styles = useMemo(() => new Map(drawn.map((s) => [s.id, overlay.style(s)] as const)), [drawn, overlay]);
    const widths = useMemo(
        () => new Map(lines.lines.map((l) => [l.id, overlay.lineWidth(l.stops.flatMap((id) => stations.byId.get(id) ?? []))] as const)),
        [lines.lines, stations.byId, overlay],
    );
    const docs = useMemo(() => (graph ? docStations(graph, stations) : new Set<string>()), [graph, stations]);
    const describes = useMemo(() => {
        const links = graph ? describesLinks(graph, stations, docs) : [];
        return routeLines({
            lines: links.map((l) => ({ id: `${l.from}>${l.to}`, hops: [{ from: l.from, to: l.to }] })),
            positions: layout.positions, bands: layout.bands, bandIndex: layout.bandIndex,
        });
    }, [graph, stations, docs, layout]);
    const walls = useMemo(
        () => httpWalls(layout.routes, routeStations(stations.stations, index)),
        [layout, stations.stations, index],
    );
    const termini = useMemo(() => {
        // Every mark is an obstacle; each end placed becomes one for the next.
        const marks: Box[] = drawn.flatMap((s) => {
            const at = layout.positions.get(s.id), r = (styles.get(s.id)?.size ?? 8) + 4;
            return at ? [{ x: at.x - r, y: at.y - r, w: r * 2, h: r * 2 }] : [];
        });
        const taken: Box[] = [];
        return groupTermini(lines.lines, stations.byId, graph).flatMap((info): PlacedTerminus[] => {
            const from = layout.positions.get(info.stationId);
            if (!from) return [];
            const at = placeTerminus(from, styles.get(info.stationId)?.size ?? 8, marks, taken);
            taken.push(terminusBox(at));
            return [{ info, from, at }];
        });
    }, [lines.lines, stations.byId, graph, layout, drawn, styles]);
    const obstacles = useMemo(() => termini.map((t) => terminusBox(t.at)), [termini]);
    return { layout, layoutPending, index, findings, drawn, styles, widths, docs, describes, termini, obstacles, walls };
}
