/**
 * Systems (PRD 41 A9): a review root that holds several projects reads as several systems. The
 * analysis tags every file node with the `system` it belongs to (its folder, '' or absent for a
 * single-system root), the `app` inside it, and `copyOf` when the file sits in a stray copy of
 * another system. ONE reader, `systemsOf`, turns that into the list the rail, the System camera,
 * the line allotment and the diagnostics all use: the graph's own `meta.systems` when it carries
 * them, else derived from the node fields. A copy is folded under its original (`foldedSystem`).
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { fileNodesOf } from './outlineGraph';

export interface SystemInfo {
    /** The system's folder under the review root. */
    path: string;
    name: string;
    files: number;
    /** Stored binary files (assets) of this system; they are not in `files`. */
    assets?: number;
    apps: string[];
    /** The reference graph did not read every file of this system (see `graphRead.skipped`): a file too large, unreadable, unsupported, or never listed. There is no file-count cap. */
    truncated?: boolean;
    /** Set when this system is a stray copy of the system at that path. */
    copyOf?: string;
    /** How alike the copy is to its original (0 to 1, or a percent), and why it is the copy. */
    copySimilarity?: number;
    copyReason?: string;
    /** What the reference graph read of this system, and what it skipped, by reason. */
    graphRead?: { read: number; skipped: { reason: string; count: number }[] };
}

type Tagged = KNode & { system?: string; app?: string; copyOf?: string };

export const systemOfNode = (n: KNode): string => (n as Tagged).system ?? '';
export const appOfNode = (n: KNode): string => (n as Tagged).app ?? '';

const tailOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

const bySize = (a: SystemInfo, b: SystemInfo): number => b.files - a.files || cmp(a.path, b.path);

const cache = new WeakMap<KnowledgeGraph, SystemInfo[]>();

function fromMeta(graph: KnowledgeGraph): SystemInfo[] | null {
    const meta = (graph as { meta?: { systems?: unknown } }).meta?.systems ?? (graph.outline as { systemInfo?: unknown } | undefined)?.systemInfo;
    if (!Array.isArray(meta) || meta.length === 0) return null;
    return meta.flatMap((m): SystemInfo[] => {
        const s = m as Partial<SystemInfo> | null;
        if (!s || typeof s.path !== 'string') return [];
        return [{
            path: s.path, name: s.name || tailOf(s.path), files: Number(s.files) || 0, ...(Number(s.assets) > 0 ? { assets: Number(s.assets) } : {}),
            apps: (Array.isArray(s.apps) ? s.apps : []).map((a: unknown) => (typeof a === 'string' ? a : (a as { name?: string; path?: string }).name || (a as { path?: string }).path || '')).filter(Boolean),
            ...(s.truncated ? { truncated: true } : {}), ...(s.copyOf ? { copyOf: s.copyOf } : {}),
            ...(s.copySimilarity !== undefined ? { copySimilarity: s.copySimilarity } : {}), ...(s.copyReason ? { copyReason: s.copyReason } : {}),
            ...(s.graphRead ? { graphRead: s.graphRead } : {}),
        }];
    });
}

function fromNodes(graph: KnowledgeGraph): SystemInfo[] {
    const by = new Map<string, { files: number; assets: number; apps: Set<string>; copyOf?: string }>();
    for (const n of fileNodesOf(graph)) {
        const path = systemOfNode(n);
        if (!path) continue;
        const row = by.get(path) ?? by.set(path, { files: 0, assets: 0, apps: new Set() }).get(path)!;
        if (n.badges?.asset === 1) row.assets += 1; else row.files += 1;
        const app = appOfNode(n);
        if (app) row.apps.add(app);
        const copyOf = (n as Tagged).copyOf;
        if (copyOf && !row.copyOf) row.copyOf = copyOf;
    }
    return [...by].map(([path, r]) => ({
        path, name: tailOf(path), files: r.files, ...(r.assets > 0 ? { assets: r.assets } : {}), apps: [...r.apps].sort(cmp), ...(r.copyOf ? { copyOf: r.copyOf } : {}),
    }));
}

/** Every system of the graph (copies included), largest first. [] when no file is tagged: a single-system root. */
export function systemsOf(graph: KnowledgeGraph): SystemInfo[] {
    const hit = cache.get(graph);
    if (hit) return hit;
    const out = (fromMeta(graph) ?? fromNodes(graph)).sort(bySize);
    cache.set(graph, out);
    return out;
}

/** The systems that stand on their own (copies are folded under their original), largest first. */
export const primarySystems = (systems: readonly SystemInfo[]): SystemInfo[] => systems.filter((s) => !s.copyOf);

/** More than one system stands on its own: the rail groups, lines are named `system › package`, the System camera shows a tier per system. */
export const isMultiSystem = (systems: readonly SystemInfo[] | undefined): boolean => primarySystems(systems ?? []).length > 1;

/** A copy's path → its original's path. */
export function copyMap(systems: readonly SystemInfo[]): Map<string, string> {
    return new Map(systems.flatMap((s) => (s.copyOf ? [[s.path, s.copyOf] as const] : [])));
}

/** The system a path stands under: a copy reads as its original. */
export const foldedSystem = (copies: ReadonlyMap<string, string>, path: string): string => copies.get(path) ?? path;

export function systemName(systems: readonly SystemInfo[] | undefined, path: string | undefined): string | undefined {
    if (path === undefined) return undefined;
    return systems?.find((s) => s.path === path)?.name ?? (path ? tailOf(path) : undefined);
}

const folded = new WeakMap<KnowledgeGraph, KnowledgeGraph>();

/**
 * The graph with the findings of stray copies folded away: a finding whose nodes all lie in a copy
 * of another system is the original's finding said again, so it is neither listed nor counted. The
 * `duplicate-copy` finding itself stays (it is the one that names the copy). The same graph comes
 * back when nothing folds.
 */
export function foldCopyFindings(graph: KnowledgeGraph): KnowledgeGraph {
    const hit = folded.get(graph);
    if (hit) return hit;
    const inCopy = new Set<string>();
    for (const n of graph.nodes) if ((n as Tagged).copyOf) inCopy.add(n.ref);
    const kept = inCopy.size === 0
        ? graph.findings
        : graph.findings.filter((f) => f.kind === 'duplicate-copy' || f.nodes.length === 0 || !f.nodes.every((ref) => inCopy.has(ref)));
    const out = kept.length === graph.findings.length ? graph : { ...graph, findings: kept };
    folded.set(graph, out);
    return out;
}
