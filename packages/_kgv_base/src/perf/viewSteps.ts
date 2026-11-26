/**
 * The pure steps behind the Transit map / Tower map (the pieces of `useTransitModel`, `useTransitLabels`, the card and the
 * unfold), the Mind map and the Sequence diagram. The hooks are replayed with the real functions they call, in their order.
 */

import { fileNodesOf } from '../surface/outlineGraph';
import { buildMindTree, layoutMindMap, mindMap } from '../map/mindMapModel';
import { buildDirs, worstSeverity } from '../map/folderTree';
import { labelFitsAt } from '../map/labelBudget';
import { fitView } from '../graph2d/layout2d';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { nodeIndex } from '../graphModel';
import { stationNote } from '../surface/pathNotes';
import { routeLines } from '../surface/transit/corridors';
import { buildCard } from '../surface/transit/cardModel';
import { placeCard } from '../surface/transit/cardPlacement';
import { describesLinks, docStations } from '../surface/transit/docs';
import { roundedPath } from '../surface/transit/geometry';
import { placeLabels, type Box, type LabelItem } from '../surface/transit/labelPlacement';
import { groupTermini } from '../surface/transit/termini';
import { placeTerminus, terminusBox } from '../surface/transit/terminusPlace';
import { byDepth, towerBox } from '../surface/transit/TowerMark';
import { satelliteBoxes, satellitePlaces, satellitesOf } from '../surface/transit/unfold';
import { httpWalls, routeStations } from '../surface/transit/wall';
import { layoutTransit } from '../surface/transitLayout';
import { sequenceOf, toSequenceMermaid } from '../surface/sequenceModel';
import { hopText } from '../surface/sequenceText';
import type { Recorder } from './harness';
import type { Shared } from './modelSteps';
import type { PerfGraph } from './syntheticGraph';

const WIDTH = 1280;

export function runTransitSteps(rec: Recorder, p: PerfGraph, s: Shared): void {
    const { graph } = p;
    const stations = rec.need(s.stations, 'stations');
    const lines = rec.need(s.lines, 'lines');
    const overlay = rec.need(s.overlay, 'overlay');
    const size = `stations=${stations.stations.length} lines=${lines.lines.length}`;
    const index = nodeIndex(graph);

    const layout = rec.time('layoutTransit', 'Transit map, Tower map', `${size} width=${WIDTH}`, () => layoutTransit(stations.stations, lines.lines, WIDTH));
    const lay = rec.need(layout, 'layoutTransit');
    const drawn = lay.drawn.flatMap((id) => stations.byId.get(id) ?? []);
    const styles = rec.time('overlay.style per drawn station + lineWidth per line', 'Transit map, Tower map', `drawn=${drawn.length}`, () => ({
        s: new Map(drawn.map((st) => [st.id, overlay.style(st)] as const)),
        w: new Map(lines.lines.map((l) => [l.id, overlay.lineWidth(l.stops.flatMap((id) => stations.byId.get(id) ?? []))] as const)),
    }));
    const st = rec.need(styles, 'styles').s;
    const docs = rec.time('docStations', 'Transit map, Tower map', `nodes=${graph.nodes.length}`, () => docStations(graph, stations)) ?? new Set<string>();
    rec.time('describesLinks + routeLines (dashed "describes" routes)', 'Transit map, Tower map', `docs=${docs.size}`, () => {
        const links = describesLinks(graph, stations, docs);
        return routeLines({ lines: links.map((l) => ({ id: `${l.from}>${l.to}`, hops: [{ from: l.from, to: l.to }] })), positions: lay.positions, bands: lay.bands, bandIndex: lay.bandIndex });
    });
    rec.time('routeStations + httpWalls', 'Transit map, Tower map', `routes=${lay.routes.length} nodes=${graph.nodes.length}`, () => httpWalls(lay.routes, routeStations(stations.stations, index)));
    rec.time('roundedPath per hop route', 'Transit map, Tower map (HopPath)', `routes=${lay.routes.length}`, () => lay.routes.map((r) => roundedPath(r.pts)));

    const marks: Box[] = drawn.flatMap((d) => {
        const at = lay.positions.get(d.id), r = (st.get(d.id)?.size ?? 8) + 4;
        return at ? [{ x: at.x - r, y: at.y - r, w: r * 2, h: r * 2 }] : [];
    });
    const termini = rec.time('groupTermini + placeTerminus (termini)', 'Transit map, Tower map', `lines=${lines.lines.length} marks=${marks.length}`, () => {
        const taken: Box[] = [];
        return groupTermini(lines.lines, stations.byId, graph).flatMap((info) => {
            const from = lay.positions.get(info.stationId);
            if (!from) return [];
            const at = placeTerminus(from, st.get(info.stationId)?.size ?? 8, marks, taken);
            taken.push(terminusBox(at));
            return [{ info, from, at }];
        });
    }) ?? [];
    const obstacles = termini.map((t) => terminusBox(t.at));
    for (const tower of [false, true]) {
        rec.time(`placeLabels (${tower ? 'Tower map' : 'Transit map'})`, tower ? 'Tower map' : 'Transit map', `drawn=${drawn.length}`, () => {
            const items: LabelItem[] = [...drawn].sort((a, b) => b.use - a.use).flatMap((d): LabelItem[] => {
                const pos = lay.positions.get(d.id);
                if (!pos) return [];
                const style = st.get(d.id);
                return [{ id: d.id, x: pos.x, y: pos.y, r: (style?.size ?? 8) + 4, mark: tower && style ? towerBox(pos, style, d.cx) : undefined, name: d.name, note: stationNote(d, L) }];
            });
            return placeLabels(items, { width: lay.width, height: lay.height, obstacles });
        });
    }
    rec.time('byDepth (Tower paint order)', 'Tower map', `drawn=${drawn.length}`, () => byDepth(drawn, lay.positions));

    // The biggest station: the card and the unfold read all of its files.
    const big = [...stations.stations].sort((a, b) => b.files - a.files)[0];
    if (big) {
        const findings = new Map(graph.findings.map((f) => [f.id, f] as const));
        rec.time('findings by id map', 'Transit map, Tower map', `findings=${graph.findings.length}`, () => new Map(graph.findings.map((f) => [f.id, f] as const)));
        rec.time('buildCard (biggest station)', 'Transit map, Tower map (station card)', `station files=${big.files} findings=${big.findingIds.length}`, () => buildCard({
            station: big, labels: L, layerName: big.layer ?? 'other', findings, index, enter: { can: false, reason: 'deepest' }, satellites: 0, unfolded: false, leaf: false, stations: stations.stations,
        } as never));
        rec.time('satellitesOf + places + boxes (unfold, biggest station)', 'Transit map, Tower map (unfold)', `station files=${big.files}`, () => {
            const sats = satellitesOf(big, index);
            const places = satellitePlaces({ x: 600, y: 200 }, sats.length, false);
            return satelliteBoxes(places, sats);
        });
        rec.time('placeCard', 'Transit map, Tower map (station card)', 'one card', () => placeCard({ left: 600, top: 200, width: 16, height: 16 }, { width: WIDTH, height: lay.height }));
    }
}

export function runMindSteps(rec: Recorder, p: PerfGraph): void {
    const { graph } = p;
    const files = graph.nodes.filter((n) => n.kind === 'file');
    const outlineFiles = fileNodesOf(graph);
    for (const [name, nodes] of [['cut graph files', files], ['outline files (stress)', outlineFiles]] as const) {
        const size = `files=${nodes.length} findings=${graph.findings.length}`;
        const sev = rec.time(`worstSeverity (${name})`, 'Mind map', size, () => worstSeverity(graph.findings));
        rec.time(`buildDirs (${name})`, 'Mind map', size, () => buildDirs(nodes, sev ?? new Map()));
        rec.time(`buildMindTree (${name})`, 'Mind map', size, () => buildMindTree(nodes, graph.findings));
        const tree = buildMindTree(nodes, graph.findings);
        rec.time(`layoutMindMap (${name})`, 'Mind map', `root children=${tree.children.length}`, () => layoutMindMap(tree));
        const map = rec.time(`mindMap total (${name})`, 'Mind map (the idle value)', size, () => mindMap(nodes, graph.findings));
        if (map) {
            rec.time(`fitView + labelFitsAt per branch (${name})`, 'Mind map', `branches=${map.branches.length}`, () => {
                fitView(map, 1280, 720);
                return map.branches.map((b) => labelFitsAt({ radius: b.radius, span: b.span, angle: b.angle, room: b.room, chars: Math.min(24, b.name.length), font: 1 }));
            });
        }
    }
    const folder = 'Builderforce.ai';
    rec.time('mindMap focused on a top folder', 'Mind map (a click)', `files=${files.length}`, () => mindMap(files, graph.findings, { focus: folder }));
}

export function runSequenceSteps(rec: Recorder, s: Shared): void {
    const stations = rec.need(s.stations, 'stations');
    const lines = rec.need(s.lines, 'lines');
    const best = [...lines.lines].sort((a, b) => b.stops.length - a.stops.length)[0];
    if (!best) { rec.unreachable('sequenceOf + toSequenceMermaid', 'Sequence', 'the synthetic graph produced no line'); return; }
    const path = { stops: best.stops.map((id) => ({ id, name: stations.byId.get(id)?.name ?? id })), hops: best.hops.map((h) => ({ kind: 'references', count: h.count })) };
    rec.time('sequenceOf + toSequenceMermaid', 'Sequence', `stops=${path.stops.length} hops=${path.hops.length}`, () => toSequenceMermaid(sequenceOf(path as never), (hop) => hopText(L, hop)));
}
