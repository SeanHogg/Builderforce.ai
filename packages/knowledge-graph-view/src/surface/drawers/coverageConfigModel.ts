/**
 * Where coverage is configured, per package, read from the graph the person already has: a
 * package whose code files carry the `coverage` badge has coverage configured and collected;
 * a package with code but no badge anywhere does not. Nothing is read from disk, and nothing
 * is claimed about a flag such as `all: false`: the graph cannot see it.
 *
 * `uncovered` is the list the *Apply: v8 coverage* action names to the composer (the view never
 * writes a file itself).
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { cmp } from '../../order';
import { isTestPath } from './testShapeModel';

/** Folders that hold packages one level down (`packages/foo` is the package `packages/foo`). */
const CONTAINERS: ReadonlySet<string> = new Set(['packages', 'clients', 'apps', 'services', 'libs', 'modules', 'crates', 'plugins']);

/** The package a root-relative path belongs to; `.` for a file at the root. */
export function packageOfPath(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return '.';
    return CONTAINERS.has(parts[0]!) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

export interface CoverageConfigModel {
    /** Packages with code and at least one coverage badge. */
    configured: string[];
    /** Packages with code and no coverage badge. */
    uncovered: string[];
    /** Packages with code (test files do not make a package). */
    packages: number;
}

export function coverageConfigModel(graph: Pick<KnowledgeGraph, 'nodes'>): CoverageConfigModel {
    const withBadge = new Set<string>();
    const all = new Set<string>();
    for (const n of graph.nodes) {
        if (n.kind !== 'file' || n.pack !== 'code') continue;
        const path = pathOf(n.ref);
        if (!path || isTestPath(path)) continue;
        const pkg = packageOfPath(path);
        all.add(pkg);
        if (n.badges?.coverage !== undefined && n.badges.coverage !== '') withBadge.add(pkg);
    }
    const sorted = (xs: Iterable<string>) => [...xs].sort(cmp);
    return {
        configured: sorted(withBadge),
        uncovered: sorted([...all].filter((p) => !withBadge.has(p))),
        packages: all.size,
    };
}
