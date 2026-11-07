/**
 * Static reach: the coverage fallback for a folder no coverage report was collected for. A file
 * is "reached" when a test file gets to it by following `references` edges (a test imports a
 * module that calls it) within MAX_DEPTH hops. It is a HEURISTIC, never a measurement: a reached
 * file may still be barely exercised, so the surface labels it "reached", not "covered".
 *
 * Bounded (a breadth-first walk with a depth cap, each file visited once) and memoized: ONE
 * walk per graph object. Test files are found by the existing `isTestPath`.
 */

import type { KnowledgeGraph, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../graphModel';
import { isTestPath } from './drawers/testShapeModel';
import { fileNodesOf, mapEdges } from './outlineGraph';

/** Hops from a test file that still count as reached (test → helper → module → module). */
export const MAX_REACH_DEPTH = 4;

export interface StaticReach {
    /** The test files of the graph. */
    tests: ReadonlySet<NodeRef>;
    /** The non-test files a test reaches within {@link MAX_REACH_DEPTH}. */
    reached: ReadonlySet<NodeRef>;
}

const fileOf = (ref: NodeRef): NodeRef => {
    const hash = ref.indexOf('#');
    return hash >= 0 ? (ref.slice(0, hash) as NodeRef) : ref;
};

const memo = new WeakMap<KnowledgeGraph, StaticReach | null>();

/** The reach of the graph's test files; null when the graph holds no test file (reach is not measurable, not 0%). */
export function staticReach(graph: KnowledgeGraph): StaticReach | null {
    if (memo.has(graph)) return memo.get(graph) ?? null;
    const files = fileNodesOf(graph);
    const tests = new Set(files.filter((n) => isTestPath(pathOf(n.ref) ?? n.label)).map((n) => n.ref));
    let result: StaticReach | null = null;
    if (tests.size > 0) {
        const next = new Map<NodeRef, NodeRef[]>();
        for (const e of mapEdges(graph)) {
            if (e.kind !== 'references') continue;
            const from = fileOf(e.from), to = fileOf(e.to);
            if (from !== to) (next.get(from) ?? next.set(from, []).get(from)!).push(to);
        }
        const seen = new Set(tests);
        let frontier = [...tests];
        for (let depth = 0; depth < MAX_REACH_DEPTH && frontier.length > 0; depth += 1) {
            const following: NodeRef[] = [];
            for (const ref of frontier) {
                for (const to of next.get(ref) ?? []) {
                    if (seen.has(to)) continue;
                    seen.add(to);
                    following.push(to);
                }
            }
            frontier = following;
        }
        result = { tests, reached: new Set([...seen].filter((ref) => !tests.has(ref))) };
    }
    memo.set(graph, result);
    return result;
}

/**
 * The share (0–1) of the given files that a test reaches. Test files themselves are not counted;
 * undefined when there is nothing to measure (no test file in the graph, or only test files here).
 */
export function reachOf(reach: StaticReach | null, refs: readonly NodeRef[]): number | undefined {
    if (!reach) return undefined;
    const code = refs.filter((ref) => !reach.tests.has(ref));
    return code.length === 0 ? undefined : code.filter((ref) => reach.reached.has(ref)).length / code.length;
}
