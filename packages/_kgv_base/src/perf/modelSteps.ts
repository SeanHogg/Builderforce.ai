/**
 * The shared model layer every view sits on, between "the graph arrives" and "first frame": folding copy findings,
 * the outline decode, focus and lens, the stations / lines / overlay of the surface, the question lit set, the path,
 * and the findings rollups (Act rail, Insights, anti-patterns, diagnostics). Real exported functions only.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { graphDiagnostics, truncationReasons } from '../graphDiagnostics';
import { focusGraph, lensGraph, nodeIndex, partitionMatrix, type VisibleGraph } from '../graphModel';
import { insightsOf } from '../insights/insightsModel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES, lensFindings, lensesFor } from '../lenses';
import { sameGraph } from '../stableGraph';
import { actionCards } from '../surface/actModel';
import { dataCoverage } from '../surface/dataCoverage';
import { groupAntiPatterns } from '../surface/drawers/antiPatternGroups';
import { patternMatrix } from '../surface/drawers/patternsModel';
import { fixQueueCounts } from '../surface/fix/fixModes';
import { findingDetail, findingItems, findingRequest, findingTitle } from '../findingText';
import { buildLines, type LinesModel } from '../surface/lines';
import { makeOverlay, PRESETS, type OverlayModel } from '../surface/overlays';
import { fileNodesOf, mapEdges, outlineView } from '../surface/outlineGraph';
import { pathOfLine, pathOfStations, type PathModel } from '../surface/path';
import { QUESTIONS, litStations } from '../surface/questions';
import { scopeFindings } from '../surface/scope';
import { hopRouteLabels, pathMermaid } from '../surface/sequenceText';
import { buildStations, changedRefs, type StationModel } from '../surface/stations';
import { copyMap, foldCopyFindings, systemsOf } from '../surface/systems';
import { highlightFor, stationRolesOf } from '../surface/towerHighlight';
import { docStations } from '../surface/transit/docs';
import { groupTermini } from '../surface/transit/termini';
import { coldGraph } from './cold';
import type { Recorder } from './harness';
import type { PerfGraph } from './syntheticGraph';

export const MAX_DRAWN_NODES = 2000; // KnowledgeGraphView's own constant (not exported)

export interface Shared {
    stations?: StationModel | undefined;
    lines?: LinesModel | undefined;
    overlay?: OverlayModel | undefined;
    visible?: VisibleGraph | undefined;
    drawn?: VisibleGraph | undefined;
    path?: PathModel | undefined;
}

/** Fills `out` as it goes, so a step that fails late still leaves the earlier results for the views. */
export function runModelSteps(rec: Recorder, p: PerfGraph, out: Shared = {}): Shared {
    const { graph } = p;
    const size = `nodes=${graph.nodes.length} edges=${graph.edges.length} findings=${graph.findings.length}`;
    const cold = (): KnowledgeGraph => coldGraph(graph);

    rec.time('foldCopyFindings', 'all (KnowledgeGraphView, every render of a new graph)', size, () => foldCopyFindings(graph));
    rec.time('outlineView decode (cold)', 'Transit map, Tower map, Systems', `outline files=${graph.outline!.files.length} links=${graph.outline!.links.length}`, (g: KnowledgeGraph) => outlineView(g), cold);
    const view = outlineView(graph);
    rec.time('fileNodesOf + mapEdges (warm)', 'Transit map, Tower map', `files=${view?.files.length} edges=${view?.edges.length}`, () => { fileNodesOf(graph); return mapEdges(graph); });
    rec.time('systemsOf + copyMap (cold)', 'Transit map, stations, lines', size, (g: KnowledgeGraph) => copyMap(systemsOf(g)), () => ({ ...graph }));
    rec.time('dataCoverage (cold)', 'Transit map overlay, Tower map, Lines panel', size, (g: KnowledgeGraph) => dataCoverage(g), cold);

    // Focus and lens: the drawn subset.
    out.visible = rec.time('focusGraph (top 2000, cold)', 'Graph 2D, 3D scene, Towers', size, (g: Pick<KnowledgeGraph, 'nodes' | 'edges'>) => focusGraph(g, MAX_DRAWN_NODES, []), () => ({ nodes: graph.nodes, edges: [...graph.edges] }));
    const visible = rec.need(out.visible, 'focusGraph');
    rec.time('focusGraph (cold) + 1 selected node outside the base', 'Graph 2D, 3D scene, Towers', size, (g: Pick<KnowledgeGraph, 'nodes' | 'edges'>) => focusGraph(g, MAX_DRAWN_NODES, [p.offBase]), () => ({ nodes: graph.nodes, edges: [...graph.edges] }));
    const lenses = lensesFor(graph);
    rec.time('lensGraph (every applicable lens)', 'Graph 2D, 3D scene', `lenses=${lenses.length} drawn edges=${visible.edges.length}`, () => lenses.map((l) => lensGraph(visible, l)));
    out.drawn = lensGraph(visible, LENSES.structure);
    rec.time('sameGraph (useStableGraph compare)', 'Graph 2D, 3D scene, Mind map', `nodes=${visible.nodes.length} edges=${visible.edges.length}`, () => sameGraph(visible, { nodes: [...visible.nodes], edges: [...visible.edges] }));
    const index = rec.time('nodeIndex', 'all', `nodes=${graph.nodes.length}`, () => nodeIndex(graph));

    // The surface: stations, lines, overlay, question, path.
    out.stations = rec.time('buildStations (cold)', 'Transit map, Tower map, 3D Towers, Lines panel', `outline files=${view?.files.length}, findings=${graph.findings.length}`, (g: KnowledgeGraph) => buildStations(g, { changed: new Set(changedRefs(g, null)) }), cold);
    const stations = rec.need(out.stations, 'buildStations');
    out.lines = rec.time('buildLines (cold)', 'Transit map, Tower map, Sequence, Lines panel', `stations=${stations.stations.length}, outline links=${view?.edges.length}`, (g: KnowledgeGraph) => buildLines(g, stations), cold);
    const lines = rec.need(out.lines, 'buildLines');
    out.overlay = rec.time('makeOverlay + style per station + lineWidth', 'Transit map, Tower map, 3D Towers', `stations=${stations.stations.length}`, () => {
        const o = makeOverlay(PRESETS.risk, stations.stations);
        for (const s of stations.stations) o.style(s);
        for (const l of lines.lines) o.lineWidth(l.stops.flatMap((id) => stations.byId.get(id) ?? []));
        return o;
    });
    const ctx = { lines, line: lines.lines[0] ?? null, selected: null, family: null };
    rec.time('litStations (every question)', 'Transit map, Tower map, Act rail', `questions=${QUESTIONS.length} stations=${stations.stations.length}`, () => QUESTIONS.map((q) => litStations(q.id, stations.stations, ctx)));
    out.path = rec.time('pathOfLine', 'Sequence, Path strip', `stops=${lines.lines[0]?.stops.length}`, () => pathOfLine(lines.lines[0] ?? null, stations.byId));
    const pinned = (lines.lines[0]?.stops ?? []).map((id) => stations.byId.get(id)?.refs[0]).filter((r): r is string => !!r);
    rec.time('pathOfStations (cold: fresh outline edges array)', 'Sequence, Path strip, Transit map', `pinned=${pinned.length} edges=${mapEdges(graph).length}`, (e: ReturnType<typeof mapEdges>) => pathOfStations(pinned, stations, e), () => mapEdges(graph).slice());
    rec.time('pathOfStations (warm: station-pair memo hit)', 'Sequence, Path strip, Transit map', `pinned=${pinned.length}`, () => pathOfStations(pinned, stations, mapEdges(graph)));
    rec.time('hopRouteLabels + pathMermaid', 'Sequence, Path strip', `hops=${out.path?.hops.length}`, () => (out.path ? [hopRouteLabels(out.path, stations.byId, index!), pathMermaid(out.path, L)] : null));
    rec.time('groupTermini + docStations (legend extras)', 'Transit map, Tower map', `lines=${lines.lines.length}`, () => ({ t: groupTermini(lines.lines, stations.byId, graph), d: docStations(graph, stations) }));

    // Findings: scoped lists, Act cards, Insights, anti-patterns, the diagnostics text.
    const scope = new Set(out.path?.stops.map((s) => s.id) ?? []);
    rec.time('scopeFindings (no scope)', 'Act rail, Findings panel', size, () => scopeFindings(graph.findings, stations, null));
    const scoped = rec.time('scopeFindings (path scope)', 'Act rail, Findings panel', `findings=${graph.findings.length} scope stations=${scope.size}`, () => scopeFindings(graph.findings, stations, scope)) ?? [];
    rec.time('lensFindings (every lens) + scopeFindings', 'Findings panel (Details list)', `findings=${graph.findings.length}`, () => lenses.map((l) => scopeFindings(lensFindings(l, graph), stations, null)));
    rec.time('actionCards', 'Act rail', `findings=${scoped.length}`, () => actionCards(scoped, true));
    rec.time('insightsOf (cold)', 'Insights panel (Details), all views', size, (g: KnowledgeGraph) => insightsOf(g), cold);
    rec.time('insightsOf (warm: memo hit)', 'Insights panel (Details), all views', size, () => insightsOf(graph));
    rec.time('partitionMatrix (cold)', 'Partition matrix, Insights', `edges=${graph.edges.length}`, (g: KnowledgeGraph) => partitionMatrix(g), cold);
    rec.time('partitionMatrix (warm: memo hit)', 'Partition matrix, Insights', `edges=${graph.edges.length}`, () => partitionMatrix(graph));
    rec.time('groupAntiPatterns', 'Anti-patterns drawer, Act rail', `findings=${graph.findings.length}`, () => groupAntiPatterns(graph.findings));
    rec.time('patternMatrix (cold)', 'Patterns drawer', `nodes=${graph.nodes.length} findings=${graph.findings.length}`, (g: KnowledgeGraph) => patternMatrix(g, stations), cold);
    rec.time('fixQueueCounts', 'Act rail, header', `findings=${graph.findings.length}`, () => fixQueueCounts(graph.findings, graph.findings.length, new Set()));
    const violations = graph.findings.filter((f) => f.kind === 'partition-violation');
    const lit = rec.time('highlightFor (all violations) + stationRolesOf', 'Towers, Tower map (Show in Tower)', `findings=${violations.length}`, () => { const h = highlightFor(violations); return stationRolesOf(h.roles, stations); });
    void lit;
    rec.time('findingTitle/Items/Request/Detail (first 200)', 'Findings panel, Act cards', 'findings=200', () => graph.findings.slice(0, 200).map((f) => [findingTitle(f, L), findingItems(f, index!), findingRequest(f, L, index!), findingDetail(f, L, index!)]));
    rec.time('truncationReasons', 'diagnostics', size, () => truncationReasons(graph, visible.nodes.length, false, false));
    rec.time('graphDiagnostics (copy diagnostics text)', 'header "Copy diagnostics"', size, () => graphDiagnostics({
        status: 'ready', rootId: 'perf', graph, drawn: { nodes: visible.nodes.length, edges: visible.edges.length }, showAll: false, webgl: false, reducedMotion: false,
        mode: 'transit', width: 1280, compact: false, lens: 'structure', review: { status: 'idle' }, time: new Date(0).toISOString(),
        surface: { graph, stations, lines, coverage: dataCoverage(graph), scopeName: 'perf', scope: null, lensFindings: lensFindings(LENSES.structure, graph).length, listedFindings: graph.findings.length, queue: fixQueueCounts(graph.findings, graph.findings.length, new Set()), sync: undefined, lastReviewedAt: undefined, mapFrom: 'server-only' },
    } as never));
    return out;
}
