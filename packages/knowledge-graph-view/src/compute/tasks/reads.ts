/** The whole-graph readings: insights, the partition matrix and the anti-pattern groups. */

import { partitionMatrix } from '../../graphModel';
import { insightsOf } from '../../insights/insightsModel';
import { groupAntiPatterns } from '../../surface/drawers/antiPatternGroups';
import { modelOf } from '../stationLookup';
import { once, type Handler } from './handler';

export const insights: Handler<'insights'> = (store, { graph }) => once(() => insightsOf(store.graph(graph)));

export const matrix: Handler<'partitionMatrix'> = (store, { graph }) => once(() => partitionMatrix(store.graph(graph)));

/** Groups name their findings by position in the graph's `findings`: the main thread hands back its own objects. */
export const antiPatterns: Handler<'antiPatterns'> = (store, { graph, layer, stations }) => once(() => {
    const g = store.graph(graph);
    const at = store.indexOf(graph, 'findings');
    return groupAntiPatterns(g.findings, { layer, ...(stations ? { model: modelOf(stations) } : {}) })
        .map((group) => ({ ...group, findings: Uint32Array.from(group.findings, (f) => at.get(f)!) }));
});
