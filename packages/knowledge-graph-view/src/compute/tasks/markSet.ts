/**
 * The MarkSet (PRD 43 B1a rules 1–3): ONE slot per thing any camera can draw, built once per graph, in this order —
 *
 *   `node:<ref>` for EVERY node of the graph (slot = the node's index, not the 2,000-node focus cap),
 *   `st:<id>`   per station aggregate (the surface's own `buildStations`),
 *   `dir:<path>` per mind-map folder (`buildDirs`, the mind map's own tree; `dir:` is the root).
 *
 * `type` is `markTypeOf` (`shapes.ts`, the ONE registry) as an index into `MARK_TYPE_ORDER`; an aggregate takes its
 * members' dominant type. `parentStation` / `parentFolder` are the forest a placement anchors hidden slots on (rule 4).
 * Pure; runs in the worker.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { buildDirs, dirParts, walkDirs, type Dir } from '../../map/folderTree';
import { pathOf } from '../../graphModel';
import { importanceOf } from '../../order';
import { dominantOfCounts, dominantType, markTypeOf, MARK_TYPE_ORDER, type MarkType } from '../../shapes';
import { fileRefOf, stationOfRef, type StationModel } from '../../surface/stations';
import { capacityFor } from '../../stage/slots';
import { SLOT_FOLDER, SLOT_NODE, SLOT_STATION, SLOT_UNIT, type MarkSet } from '../../stage/types';

const TYPE_INDEX = new Map<MarkType, number>(MARK_TYPE_ORDER.map((t, i) => [t, i]));
export const typeIndex = (t: MarkType): number => TYPE_INDEX.get(t)!;

const NO_SEVERITIES = new Map();
const baseName = (ref: string): string => { const p = pathOf(ref as never) ?? ref; return p.slice(p.lastIndexOf('/') + 1); };

/**
 * A short, stable digest of the localized `strings` (FNV-1a over the sorted entries). It is part of the MarkSet's digest
 * and of the held stage model's key (`stageModelOf`), so a locale change rebuilds — re-localizes — the model, under a
 * new MarkSet generation that every placement is cached by.
 */
export function stringsDigest(strings: Readonly<Record<string, string>>): string {
    let h = 0x811c9dc5;
    for (const k of Object.keys(strings).sort()) {
        const s = `${k}\u0000${strings[k]}\u0001`;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    }
    return (h >>> 0).toString(36);
}

/** The key of a folder slot. */
export const dirKey = (path: string): string => `dir:${path}`;

export function buildMarkSet(g: KnowledgeGraph, stations: StationModel, generation: number, strings: Readonly<Record<string, string>> = {}): MarkSet {
    const nodes = g.nodes;
    const dirs = [...walkDirs(buildDirs(nodes, NO_SEVERITIES))];
    const n = nodes.length + stations.stations.length + dirs.length;
    const keys = new Array<string>(n), label = new Array<string>(n), tooltip = new Array<string>(n);
    const slotKind = new Uint8Array(n), type = new Uint8Array(n), importance = new Float32Array(n);
    const parentStation = new Int32Array(n).fill(-1), parentFolder = new Int32Array(n).fill(-1);

    const nodeAt = new Map<string, number>();
    const nodeType: MarkType[] = new Array(nodes.length);
    nodes.forEach((node, i) => {
        nodeAt.set(node.ref, i);
        keys[i] = `node:${node.ref}`; label[i] = node.label; tooltip[i] = pathOf(node.ref) ?? node.label;
        nodeType[i] = markTypeOf(node);
        slotKind[i] = nodeType[i] === 'unit' ? SLOT_UNIT : SLOT_NODE; importance[i] = importanceOf(node);
        type[i] = typeIndex(nodeType[i]!);
    });

    // Stations: a member file that is not a graph node (an outline-only file) is typed from its path alone.
    const stationBase = nodes.length;
    const stationAt = new Map<string, number>();
    stations.stations.forEach((s, j) => {
        const slot = stationBase + j;
        stationAt.set(s.id, slot);
        keys[slot] = `st:${s.id}`; label[slot] = s.name; tooltip[slot] = s.path ?? s.name;
        slotKind[slot] = SLOT_STATION; importance[slot] = s.use;
        const memberTypes = s.refs.map((ref) => { const at = nodeAt.get(ref); return at !== undefined ? nodeType[at]! : markTypeOf(asFile(ref)); });
        type[slot] = typeIndex(dominantType(memberTypes));
    });
    for (let i = 0; i < nodes.length; i++) {
        const id = stationOfRef(stations, nodes[i]!.ref);
        const at = id === undefined ? undefined : stationAt.get(id);
        if (at !== undefined) parentStation[i] = at;
    }

    // Folders, parents before children: a folder's type is the dominant type of every file beneath it.
    const dirBase = stationBase + stations.stations.length;
    const dirAt = new Map<string, number>();
    dirs.forEach((d, k) => dirAt.set(d.path, dirBase + k));
    const counts = new Map<string, Map<MarkType, number>>();
    for (let k = dirs.length - 1; k >= 0; k--) {
        const d = dirs[k]!, slot = dirBase + k;
        keys[slot] = dirKey(d.path); label[slot] = d.name || (strings.root ?? ''); tooltip[slot] = d.path || (strings.root ?? '');
        slotKind[slot] = SLOT_FOLDER;
        const count = tally(d, nodeAt, nodeType, counts);
        counts.set(d.path, count);
        type[slot] = typeIndex(dominantOfCounts(count));
        if (d.depth > 0) parentFolder[slot] = dirAt.get(parentPath(d.path)) ?? -1;
    }
    for (let i = 0; i < nodes.length; i++) parentFolder[i] = folderSlotOf(nodes[i]!, nodeAt, nodes, dirAt);

    return {
        generation, digest: `${g.scope.digest}|${nodes.length}|${g.edges.length}|${stations.stations.length}|${stringsDigest(strings)}`,
        keys, slotKind, type, parentStation, parentFolder, label, tooltip, importance,
        batches: batchesOf(type), capacity: capacityFor(n),
    };
}

const asFile = (ref: string): Pick<KNode, 'kind' | 'ref' | 'label' | 'badges'> => ({ kind: 'file', ref: ref as KNode['ref'], label: baseName(ref) });

const parentPath = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function tally(d: Dir, nodeAt: ReadonlyMap<string, number>, nodeType: readonly MarkType[], below: ReadonlyMap<string, Map<MarkType, number>>): Map<MarkType, number> {
    const count = new Map<MarkType, number>();
    const add = (t: MarkType, by: number) => count.set(t, (count.get(t) ?? 0) + by);
    for (const f of d.files) add(nodeType[nodeAt.get(f.ref)!] ?? 'source', 1);
    for (const sub of d.folders) for (const [t, c] of below.get(sub.path) ?? []) add(t, c);
    return count;
}

/** A file's folder; a section or symbol sits in its file's folder; an area or a pathless node in none. */
function folderSlotOf(node: KNode, nodeAt: ReadonlyMap<string, number>, nodes: readonly KNode[], dirAt: ReadonlyMap<string, number>): number {
    let file: KNode | undefined = node;
    if (node.kind !== 'file') { const at = nodeAt.get(fileRefOf(node.ref)); file = at === undefined ? undefined : nodes[at]; }
    if (!file || file.kind !== 'file') return -1;
    const parts = dirParts(file.ref);
    return parts ? dirAt.get(parts.join('/')) ?? -1 : -1;
}

/**
 * The types an append brings (a drilled symbol is a class or a function, `markTypeOf`; a Sequence's call target outside
 * the root is `external`), plus the deployable `unit` (a graph whose pack had no deploy descriptor yet gains units when it
 * is reviewed again): their batches always exist, empty when the graph holds none, so an append lands in headroom
 * instead of rebuilding the meshes (B1a rule 1). An empty batch draws nothing (an instanced draw of 0 is skipped).
 */
const DRILL_TYPES: readonly number[] = [typeIndex('class'), typeIndex('function'), typeIndex('external'), typeIndex('unit')];

/** One batch per type present (and per drill type), in legend order; each lists its slots ascending. */
export function batchesOf(type: Uint8Array): MarkSet['batches'] {
    const counts = new Uint32Array(MARK_TYPE_ORDER.length);
    for (let i = 0; i < type.length; i++) { const t = type[i]!; counts[t] = counts[t]! + 1; }
    const batches = [...counts.keys()].filter((t) => counts[t]! > 0 || DRILL_TYPES.includes(t)).map((t) => ({ type: t, slots: new Uint32Array(counts[t]!) }));
    const fill = new Uint32Array(MARK_TYPE_ORDER.length);
    const byType = new Map(batches.map((b) => [b.type, b]));
    for (let i = 0; i < type.length; i++) {
        const t = type[i]!;
        byType.get(t)!.slots[fill[t]!] = i;
        fill[t] = fill[t]! + 1;
    }
    return batches;
}
