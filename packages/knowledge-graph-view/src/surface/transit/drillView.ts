/**
 * The drill levels of the map: package (the files of one station), class (the symbols of one
 * file: its classes, methods and error/test symbols) and function (one symbol and what it
 * calls). Each level is folded to the SAME models the world map draws (a `StationModel` and a
 * `LinesModel`), by re-badging the level's members as one-file areas and running the world's
 * own `buildStations` and `buildLines` over them, so every metric reads exactly as it does one
 * level up. What the level reaches OUTSIDE itself stands in a `leaves` band, one station per
 * neighbour. A graph with no symbol nodes cannot go below a package: the class level then shows
 * the package's files and says so. Pure.
 */

import type { KEdge, KNode, KnowledgeGraph, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import { LAYER_ORDER } from '../layers';
import { buildLines, type LinesModel } from '../lines';
import { fileNodesOf, mapEdges, tailOf } from '../outlineGraph';
import { buildStations, fileRefOf, stationOfRef, type Station, type StationModel } from '../stations';
import { isErrorish, membersOfClass, shortName, symbolSort, symbolsOf, symbolsOfFile } from './symbols';

export type DrillLevel = 'package' | 'class' | 'function';
export interface DrillFrame { level: DrillLevel; ref: string; name: string }

export interface DrillView {
    level: DrillLevel;
    stations: StationModel;
    lines: LinesModel;
    /** The bands of this level, top to bottom. */
    order: string[];
    /** The stations that are outside the level (its neighbours). */
    leaves: Set<string>;
    /** The graph has no symbol nodes at all. */
    noSymbols: boolean;
    /** The level shows files because it has no symbols to show. */
    filesOnly: boolean;
}

export const MAX_MEMBERS = 60;
const MAX_LEAVES = 4;
export const LEAVES = 'leaves';

/** Whether the graph holds any symbol node (loaded definitions included): when it holds none, the levels below a package show files. */
export function hasSymbols(graph: Pick<KnowledgeGraph, 'nodes'>): boolean {
    return symbolsOf(graph).length > 0;
}

interface Member { node: KNode; role: string }

function membersOf(graph: KnowledgeGraph, world: StationModel, frame: DrillFrame): { members: Member[]; order: string[]; filesOnly: boolean; extra: KEdge[]; anchors: string[] } {
    const files = new Map(fileNodesOf(graph).map((n) => [n.ref as string, n] as const));
    const asFiles = (refs: readonly string[]): Member[] => refs.flatMap((r) => files.get(r) ?? []).map((node) => ({ node, role: node.partition ?? 'other' }));
    const symbols = symbolsOf(graph);
    const byRef = new Map(graph.nodes.map((n) => [n.ref as string, n] as const));
    if (frame.level === 'package') {
        return { members: asFiles(world.byId.get(frame.ref)?.refs ?? []), order: [...LAYER_ORDER], filesOnly: false, extra: [], anchors: [] };
    }
    if (frame.level === 'class') {
        const own = symbolsOfFile(symbols, frame.ref);
        if (own.length === 0) {
            const station = stationOfRef(world, frame.ref);
            return { members: asFiles(world.byId.get(station ?? '')?.refs ?? []), order: [...LAYER_ORDER], filesOnly: true, extra: [], anchors: [] };
        }
        const members = own.map((node) => ({ node, role: isErrorish(node) ? 'errors' : symbolSort(node) === 'class' ? 'symbol' : 'methods' }));
        // A class stands above its methods.
        const extra: KEdge[] = [];
        for (const cls of own.filter((n) => symbolSort(n) === 'class')) {
            for (const m of membersOfClass(own, cls)) extra.push({ from: cls.ref, to: m.ref, kind: 'references', weight: 1, origin: 'extracted' });
        }
        return { members, order: ['symbol', 'methods', 'errors'], filesOnly: false, extra, anchors: [frame.ref] };
    }
    const focus = byRef.get(frame.ref);
    if (!focus) return { members: [], order: ['body', 'callees'], filesOnly: false, extra: [], anchors: [] };
    const called = new Set<string>();
    for (const e of graph.edges) if (e.kind === 'references' && e.from === frame.ref && byRef.get(e.to)?.kind === 'symbol') called.add(e.to);
    const members: Member[] = [{ node: focus, role: 'body' }, ...[...called].sort(cmp).flatMap((r) => byRef.get(r) ?? []).map((node) => ({ node, role: 'callees' }))];
    return { members, order: ['body', 'callees'], filesOnly: false, extra: [], anchors: [fileRefOf(frame.ref)] };
}

export function buildDrillView(graph: KnowledgeGraph, world: StationModel, frame: DrillFrame): DrillView {
    const picked = membersOf(graph, world, frame);
    const members = [...picked.members].sort((a, b) => b.node.importance - a.node.importance || cmp(a.node.ref, b.node.ref)).slice(0, MAX_MEMBERS);
    const inside = new Set<string>(members.map((m) => m.node.ref));
    const top = members[0]?.node.ref;
    // An edge end at the file (not at a symbol) belongs to the level's most important member.
    const anchor = new Set(picked.anchors);
    const endOf = (ref: NodeRef): NodeRef | undefined => (inside.has(ref) ? ref : anchor.has(ref) ? top : undefined);

    const all: readonly KEdge[] = frame.level === 'package' ? mapEdges(graph) : [...graph.edges.filter((e) => e.kind === 'references'), ...picked.extra];
    const memberEdges: KEdge[] = [];
    const touching = new Map<string, number>();
    const own = new Set(frame.level === 'package' ? [frame.ref] : [stationOfRef(world, frame.ref) ?? '']);
    for (const e of all) {
        const a = endOf(e.from), b = endOf(e.to);
        if (a && b && a !== b) { memberEdges.push(e); continue; }
        // One end inside, the other in a neighbour station: that neighbour is a leaf.
        const outsideRef = a ? e.to : b ? e.from : undefined;
        if (!outsideRef) continue;
        const station = stationOfRef(world, outsideRef);
        if (station && !own.has(station)) touching.set(station, (touching.get(station) ?? 0) + 1);
    }
    const leafIds = [...touching].sort((p, q) => q[1] - p[1] || (world.byId.get(q[0])?.use ?? 0) - (world.byId.get(p[0])?.use ?? 0) || cmp(p[0], q[0]))
        .slice(0, MAX_LEAVES).map(([id]) => id);

    // The level's members, each a one-file area, folded by the world's own code.
    const rebadged: KNode[] = members.map(({ node, role }) => ({ ...node, kind: 'file', area: node.ref, partition: role }));
    const leafSet = new Set(leafIds);
    const leafEdges: KEdge[] = [];
    for (const e of all) {
        const a = endOf(e.from), b = endOf(e.to);
        const fromLeaf = stationOfRef(world, e.from), toLeaf = stationOfRef(world, e.to);
        if (a && !b && toLeaf && leafSet.has(toLeaf)) leafEdges.push({ ...e, from: a, to: (world.byId.get(toLeaf)!.refs[0] ?? e.to) as NodeRef });
        else if (b && !a && fromLeaf && leafSet.has(fromLeaf)) leafEdges.push({ ...e, from: (world.byId.get(fromLeaf)!.refs[0] ?? e.from) as NodeRef, to: b });
    }
    const { outline: _outline, ...plain } = graph;
    const derived: KnowledgeGraph = {
        ...plain, nodes: rebadged, edges: memberEdges.map((e) => ({ ...e, from: endOf(e.from)!, to: endOf(e.to)! })),
        stats: { ...graph.stats, truncated: false },
    };
    const built = buildStations(derived);
    const rename = (s: Station): Station => ({ ...s, name: frame.level === 'package' || picked.filesOnly ? tailOf(s.name) : shortName({ label: s.name }) });
    const stations = built.stations.map(rename);

    // Neighbours stand in the leaves band; their refs resolve to them, so the line walk reaches them.
    const stationOf = new Map(built.stationOf);
    for (const id of leafIds) for (const r of world.byId.get(id)?.refs ?? []) stationOf.set(r, id);
    // A neighbour that points into the level is where a line begins (a caller); the others are where a line ends.
    const callers = new Set(leafEdges.map((e) => stationOfRef({ stationOf }, e.from)));
    const leafStations: Station[] = leafIds.flatMap((id) => world.byId.get(id) ?? []).map((s) => ({ ...s, layer: LEAVES, entry: callers.has(s.id) }));
    const withLeaves = [...stations, ...leafStations];

    // A level with no entry files starts its lines where nothing points to it.
    const allEdges = [...derived.edges, ...leafEdges];
    const pointedTo = new Set(allEdges.map((e) => stationOfRef({ stationOf }, e.to)));
    const hasEntry = withLeaves.some((s) => s.entry);
    const lineStations = hasEntry ? withLeaves : withLeaves.map((s) => (s.layer !== LEAVES && !pointedTo.has(s.id) ? { ...s, entry: true } : s));
    const model: StationModel = { stations: lineStations, byId: new Map(lineStations.map((s) => [s.id, s] as const)), stationOf };
    const lines = buildLines({ ...derived, edges: allEdges }, model);

    return {
        level: frame.level, stations: model, lines, order: [...picked.order, LEAVES], leaves: new Set(leafIds),
        noSymbols: !hasSymbols(graph), filesOnly: picked.filesOnly,
    };
}
