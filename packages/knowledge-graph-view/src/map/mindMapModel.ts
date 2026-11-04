/**
 * The mind map's model — PURE and DETERMINISTIC. A radial tree built from the file nodes'
 * paths: root → top-level folder → subfolder (to depth 3) → the top 8 files of each folder by
 * importance, plus a "+N more" leaf for the rest. Every branch carries its file count and the
 * worst severity among the findings that touch it. Children are sorted (folders by size then
 * name, files by importance then ref) and a branch's angular span is proportional to its
 * leaves, so equal input gives equal coordinates.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../graphModel';
import { cmp, round } from '../order';
import type { ThemeTone } from '../scene/themeColors';
import type { Bounds } from '../graph2d/layout2d';

export const MAX_FOLDER_DEPTH = 3;
export const FILES_PER_FOLDER = 8;
export const RING = 14;

export type Severity = Finding['severity'];
export type MapKind = 'root' | 'folder' | 'file' | 'more';

export interface MapBranch {
    id: string;
    kind: MapKind;
    /** A folder or file name; empty for `more` (the view words it from `count`) and for the root (the view names it). */
    name: string;
    /** Files beneath (a file: 1, a "+N more" leaf: N). */
    count: number;
    /** Every file ref beneath: what a click focuses. */
    refs: string[];
    /** The file's own ref; `file` only. */
    ref?: string;
    severity?: Severity;
    tone: ThemeTone;
    children: MapBranch[];
}

export interface PlacedBranch extends MapBranch {
    depth: number;
    x: number;
    y: number;
    /** Radians; the label sits on this side. */
    angle: number;
    parent?: string;
}

export interface MindMap {
    branches: PlacedBranch[];
    bounds: Bounds;
}

const RANK: Record<Severity, number> = { info: 1, warn: 2, error: 3 };
/** Severity → tone, as data. Folders and files with nothing found keep their quiet tone. */
const SEVERITY_TONE: Record<Severity, ThemeTone> = { error: 'violation', warn: 'cycle', info: 'nodeSection' };

/** The worst severity per node ref across all findings. */
export function worstSeverity(findings: readonly Finding[]): Map<string, Severity> {
    const out = new Map<string, Severity>();
    for (const f of findings) {
        for (const ref of f.nodes) {
            const have = out.get(ref);
            if (!have || RANK[f.severity] > RANK[have]) out.set(ref, f.severity);
        }
    }
    return out;
}

interface Folder { name: string; path: string; folders: Map<string, Folder>; files: KNode[] }
const folder = (name: string, path: string): Folder => ({ name, path, folders: new Map(), files: [] });

function worst(a: Severity | undefined, b: Severity | undefined): Severity | undefined {
    return !a ? b : !b ? a : RANK[b] > RANK[a] ? b : a;
}

function toBranch(dir: Folder, kind: 'root' | 'folder', severities: ReadonlyMap<string, Severity>): MapBranch {
    const subs = [...dir.folders.values()].map((f) => toBranch(f, 'folder', severities));
    subs.sort((a, b) => b.count - a.count || cmp(a.name, b.name));
    const files = [...dir.files].sort((a, b) => b.importance - a.importance || cmp(a.ref, b.ref));
    const shown: MapBranch[] = files.slice(0, FILES_PER_FOLDER).map((n) => {
        const severity = severities.get(n.ref);
        return {
            id: n.ref, kind: 'file', name: pathOf(n.ref)?.split('/').pop() ?? n.label, count: 1, refs: [n.ref], ref: n.ref,
            ...(severity ? { severity } : {}), tone: severity ? SEVERITY_TONE[severity] : 'nodeFile', children: [],
        };
    });
    const rest = files.slice(FILES_PER_FOLDER);
    if (rest.length) {
        const severity = rest.map((n) => severities.get(n.ref)).reduce<Severity | undefined>(worst, undefined);
        shown.push({
            id: `${dir.path}\u0000more`, kind: 'more', name: '', count: rest.length, refs: rest.map((n) => n.ref),
            ...(severity ? { severity } : {}), tone: severity ? SEVERITY_TONE[severity] : 'edge', children: [],
        });
    }
    const children = [...subs, ...shown];
    const severity = children.map((c) => c.severity).reduce<Severity | undefined>(worst, undefined);
    return {
        id: dir.path || '\u0000root', kind, name: dir.name, count: children.reduce((n, c) => n + c.count, 0),
        refs: children.flatMap((c) => c.refs), ...(severity ? { severity } : {}),
        tone: severity ? SEVERITY_TONE[severity] : 'edge', children,
    };
}

/** The folder tree of the file nodes (deeper folders fold into their depth-3 ancestor). */
export function buildMindTree(nodes: readonly KNode[], findings: readonly Finding[]): MapBranch {
    const root = folder('', '');
    for (const n of nodes) {
        if (n.kind !== 'file') continue;
        const path = pathOf(n.ref);
        if (!path) continue;
        const parts = path.split('/');
        parts.pop();
        let dir = root;
        for (const part of parts.slice(0, MAX_FOLDER_DEPTH)) {
            const next = `${dir.path}${dir.path ? '/' : ''}${part}`;
            dir = dir.folders.get(part) ?? dir.folders.set(part, folder(part, next)).get(part)!;
        }
        dir.files.push(n);
    }
    return toBranch(root, 'root', worstSeverity(findings));
}

const leaves = (b: MapBranch): number => (b.children.length ? b.children.reduce((n, c) => n + leaves(c), 0) : 1);

/** Radial layout: the angle span is proportional to leaf count; depth is the ring. */
export function layoutMindMap(tree: MapBranch): MindMap {
    const branches: PlacedBranch[] = [];
    const place = (b: MapBranch, depth: number, from: number, to: number, parent?: string): void => {
        const angle = (from + to) / 2;
        const r = depth * RING;
        branches.push({ ...b, depth, angle: round(angle), x: round(r * Math.cos(angle)), y: round(r * Math.sin(angle)), ...(parent !== undefined ? { parent } : {}) });
        const total = b.children.reduce((n, c) => n + leaves(c), 0);
        let cursor = from;
        for (const c of b.children) {
            const span = ((to - from) * leaves(c)) / total;
            place(c, depth + 1, cursor, cursor + span, b.id);
            cursor += span;
        }
    };
    place(tree, 0, -Math.PI / 2, (3 * Math.PI) / 2);
    const xs = branches.map((p) => p.x), ys = branches.map((p) => p.y);
    // Labels sit beside the dots: leave room for them in x.
    const room = RING * 0.9;
    return { branches, bounds: { minX: Math.min(...xs) - room, maxX: Math.max(...xs) + room, minY: Math.min(...ys) - RING / 2, maxY: Math.max(...ys) + RING / 2 } };
}

export const mindMap = (nodes: readonly KNode[], findings: readonly Finding[]): MindMap => layoutMindMap(buildMindTree(nodes, findings));
