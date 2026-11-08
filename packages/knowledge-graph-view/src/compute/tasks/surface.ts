/** The surface model (stations, then the lines drawn over them) and a pinned path through the stations. */

import { buildLines } from '../../surface/lines';
import { mapEdges } from '../../surface/outlineGraph';
import { pathOfStations } from '../../surface/path';
import { buildStations } from '../../surface/stations';
import { modelOf } from '../stationLookup';
import { once, type Handler } from './handler';

export const surface: Handler<'surface'> = (store, { graph, changed, repoConfigName }) => once(() => {
    const g = store.graph(graph);
    const stations = buildStations(g, { changed: new Set(changed), ...(repoConfigName ? { repoConfigName } : {}) });
    return { stations, lines: buildLines(g, stations) };
});

export const path: Handler<'path'> = (store, { graph, refs, stations }) => once(() => pathOfStations(refs, modelOf(stations), mapEdges(store.graph(graph))));
