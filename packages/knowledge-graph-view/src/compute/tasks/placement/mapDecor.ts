/**
 * The Map placement's decorations beyond the routes (PRD 43 B8 Moves: what `useTransitModel` derived for the SVG map now
 * comes with the placement): the dashed "describes" links from a document station to the code it is about, routed round
 * the stations like a line (`docStations` + `describesLinks` + `routeLines`), and the HTTP boundary walls across a hop
 * that enters a station serving routes (`httpWalls`). Each is one link batch of its own family (`describes`, `wall`), so
 * the shader draws them with their own width and dash. Pure; runs in the worker.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../../../graphModel';
import type { StationModel } from '../../../surface/stations';
import type { TransitLayout } from '../../../surface/transitLayout';
import { routeLines } from '../../../surface/transit/corridors';
import { describesLinks, docStations } from '../../../surface/transit/docs';
import { httpWalls, routeStations } from '../../../surface/transit/wall';
import { toneIndex } from '../../../stage/tones';
import { DASH_DESCRIBES, DASH_WALL, type LinkBatch } from '../../../stage/types';
import { linkBatch } from './links';

const DESCRIBES_TONE = toneIndex('nodeSection');
const WALL_TONE = toneIndex('muted');

/** The describes links (`describes` family, dashed 2/5) and the HTTP walls (`wall` family, dashed 5/4); empty batches are left out. */
export function mapDecorations(g: Pick<KnowledgeGraph, 'nodes' | 'edges'>, stations: StationModel, layout: TransitLayout): LinkBatch[] {
    const out: LinkBatch[] = [];
    const docs = docStations(g, stations);
    const links = describesLinks(g, stations, docs);
    if (links.length > 0) {
        const routes = routeLines({
            lines: links.map((l) => ({ id: `${l.from}>${l.to}`, hops: [{ from: l.from, to: l.to }] })),
            positions: layout.positions, bands: layout.bands, bandIndex: layout.bandIndex,
        });
        if (routes.length > 0) out.push(linkBatch('describes', routes.map((r) => ({ pts: r.pts, tone: DESCRIBES_TONE, width: 1.5, dash: DASH_DESCRIBES, flags: 0 })), 0));
    }
    const walls = httpWalls(layout.routes, routeStations(stations.stations, nodeIndex(g)));
    if (walls.length > 0) out.push(linkBatch('wall', walls.map((w) => ({ pts: [w.a, w.b], tone: WALL_TONE, width: 2.5, dash: DASH_WALL, flags: 0 })), 0));
    return out;
}
