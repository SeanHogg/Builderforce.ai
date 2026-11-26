/**
 * The folder tree of the file nodes, as plain directories: counts, the worst finding beneath, children sorted
 * (folders by size then name, files by importance then ref). Folders deeper than {@link MAX_FOLDER_DEPTH} fold
 * into their depth-3 ancestor. PURE.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../graphModel';
import { cmp } from '../order';
import type { Severity } from './mindTypes';

export const MAX_FOLDER_DEPTH = 3;

const RANK: Record<Severity, number> = { info: 1, warn: 2, error: 3 };

export function worst(a: Severity | undefined, b: Severity | undefined): Severity | undefined {
    return !a ? b : !b ? a : RANK[b] > RANK[a] ? b : a;
}

/** The worst severity per node ref across all findings. */
export function worstSeverity(findings: readonly Finding[]): Map<string, Severity> {
    const out = new Map<string, Severity>();
    for (const f of findings) for (const ref of f.nodes) out.set(ref, worst(out.get(ref), f.severity)!);
    return out;
}

export interface Dir {
    name: string;
    /** `a/b`; empty for the root. */
    path: string;
    depth: number;
    folders: Dir[];
    /** Files directly in this folder, most important first. */
    files: KNode[];
    /** Files beneath, deeper folders included. */
    count: number;
    severity?: Severity;
}

/** A file's folder parts, cut at the depth cap. */
export function dirParts(ref: string): string[] | undefined {
    const path = pathOf(ref);
    if (!path) return undefined;
    const parts = path.split('/');
    parts.pop();
    return parts.slice(0, MAX_FOLDER_DEPTH);
}

export function buildDirs(nodes: readonly KNode[], severities: ReadonlyMap<string, Severity>): Dir {
    const make = (name: string, path: string, depth: number): Dir => ({ name, path, depth, folders: [], files: [], count: 0 });
    const root = make('', '', 0);
    const byPath = new Map<string, Dir>([['', root]]);
    for (const n of nodes) {
        if (n.kind !== 'file') continue;
        const parts = dirParts(n.ref);
        if (!parts) continue;
        let dir = root;
        for (const part of parts) {
            const next = `${dir.path}${dir.path ? '/' : ''}${part}`;
            let child = byPath.get(next);
            if (!child) { child = make(part, next, dir.depth + 1); byPath.set(next, child); dir.folders.push(child); }
            dir = child;
        }
        dir.files.push(n);
    }
    const settle = (dir: Dir): void => {
        dir.files.sort((a, b) => b.importance - a.importance || cmp(a.ref, b.ref));
        let count = dir.files.length;
        let severity = dir.files.map((n) => severities.get(n.ref)).reduce<Severity | undefined>(worst, undefined);
        for (const f of dir.folders) { settle(f); count += f.count; severity = worst(severity, f.severity); }
        dir.folders.sort((a, b) => b.count - a.count || cmp(a.name, b.name));
        dir.count = count;
        if (severity) dir.severity = severity;
    };
    settle(root);
    return root;
}

/** Every directory in the tree, parents before children. */
export function* walkDirs(dir: Dir): Generator<Dir> {
    yield dir;
    for (const f of dir.folders) yield* walkDirs(f);
}

/** Every file ref beneath a directory. */
export function refsOf(dir: Dir): string[] {
    return [...dir.folders.flatMap(refsOf), ...dir.files.map((n) => n.ref)];
}

/** The folder path every ref of `focus` shares (cut at the depth cap), or null when there is none to name. */
export function focusFolder(focus: readonly string[]): string | null {
    let common: string[] | null = null;
    for (const ref of focus) {
        const parts = dirParts(ref);
        if (!parts) continue;
        if (common === null) { common = parts; continue; }
        let k = 0;
        while (k < common.length && k < parts.length && common[k] === parts[k]) k++;
        common = common.slice(0, k);
    }
    return common === null ? null : common.join('/');
}
