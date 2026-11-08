/** The whole-graph readings: insights, the partition matrix, the anti-pattern groups and the focused node set. */

import { focusGraph, partitionMatrix } from '../../graphModel';
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

export const focus: Handler<'focus'> = (store, { graph, max, keep }) => once(() => {
    const g = store.graph(graph);
    const v = focusGraph(g, max, keep);
    if (v.nodes === g.nodes && v.edges === g.edges) return { whole: true, nodes: new Uint32Array(0), edges: new Uint32Array(0) };
    const nodeAt = store.indexOf(graph, 'nodes'), edgeAt = store.indexOf(graph, 'edges');
    return { whole: false, nodes: Uint32Array.from(v.nodes, (n) => nodeAt.get(n)!), edges: Uint32Array.from(v.edges, (e) => edgeAt.get(e)!) };
});
