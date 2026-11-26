/** The surface model (stations, then the lines drawn over them) and a pinned path through the stations. */

import { buildLines } from '../../surface/lines';
import { pathOfStations } from '../../surface/path';
import { buildStations } from '../../surface/stations';
import { layoutTransit } from '../../surface/transitLayout';
import { modelOf } from '../stationLookup';
import { once, type Handler } from './handler';

export const surface: Handler<'surface'> = (store, { graph, changed, repoConfigName, communityFallback }) => once(() => {
    const g = store.graph(graph);
    const stations = buildStations(g, { changed: new Set(changed), ...(repoConfigName ? { repoConfigName } : {}), ...(communityFallback ? { communityFallback } : {}) });
    return { stations, lines: buildLines(g, stations) };
});

/** The transit map's layout and routes, off the main thread: a pure function of the worker-built stations and lines. */
export const transitLayout: Handler<'transitLayout'> = (_store, { stations, lines, width, order }) => once(() => {
    const layout = layoutTransit(stations.stations, lines.lines, width, order ? { order } : {});
    // Flatten the two Maps so the reply carries none (structured-clone-safe, canonical-size stable).
    return {
        layout: {
            width: layout.width, height: layout.height, bands: layout.bands, drawn: layout.drawn, hiddenOnLine: layout.hiddenOnLine,
            positions: [...layout.positions].map(([id, p]) => ({ id, x: p.x, y: p.y })),
            bandIndex: [...layout.bandIndex].map(([id, band]) => ({ id, band })),
        },
        routes: layout.routes.map((r) => ({ lineId: r.lineId, index: r.index, from: r.from, to: r.to, d: r.d, pts: r.pts, mid: r.mid })),
    };
});

/** The edges and the station lookup are the store's per-graph ones, so `pathOfStations`' hop-count memo (keyed on both) hits across requests. */
export const path: Handler<'path'> = (store, { graph, refs, stations }) => once(() => pathOfStations(refs, modelOf(store.stationLookup(graph, stations)), store.surfaceEdges(graph)));
