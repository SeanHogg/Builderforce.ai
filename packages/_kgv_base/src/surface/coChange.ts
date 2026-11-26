/**
 * The co-change partners the surfaces read (PRD 38 P4): "What changed?", the fix flow's tests check and "This path is done
 * when…". The `coChange` badge is read ONLY with memory's `decodeCoChange`; nothing here predicts or re-ranks — a partner
 * keeps memory's order and its counts and interval, which `rateFormat` words.
 *
 * No file carrying the badge means there is no git history: the reading is null and the surface says "Not set up".
 */

import { COCHANGE_BADGE, decodeCoChange, type CoChangeBadgeEntry, type KnowledgeGraph, type KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fileCategory } from '../fileCategory';
import { pathOf } from '../graphModel';
import { fileNodesOf, mapEdges } from './outlineGraph';
import { fileRefOf } from './stations';

/** null = no file carries the badge (no history): "Not set up", never a guess. */
export type Partners = CoChangeBadgeEntry[] | null;

const filesMemo = new WeakMap<KnowledgeGraph, { byRef: ReadonlyMap<string, KNode>; any: boolean }>();

function filesOf(graph: KnowledgeGraph): { byRef: ReadonlyMap<string, KNode>; any: boolean } {
    const hit = filesMemo.get(graph);
    if (hit) return hit;
    const files = fileNodesOf(graph);
    const built = { byRef: new Map(files.map((n) => [n.ref, n] as const)), any: files.some((n) => n.badges?.[COCHANGE_BADGE] !== undefined) };
    filesMemo.set(graph, built);
    return built;
}

/**
 * The partners of `refs` (files, or refs inside files) that are not in `refs` themselves: each partner once, files in the
 * order given and each file's partners in memory's order, at most `max`. null when no file of the graph carries the badge.
 */
export function partnersOf(graph: KnowledgeGraph, refs: Iterable<string>, max = Infinity): Partners {
    const { byRef, any } = filesOf(graph);
    if (!any) return null;
    const own = new Set([...refs].map(fileRefOf));
    const seen = new Set<string>();
    const out: CoChangeBadgeEntry[] = [];
    for (const ref of own) {
        for (const p of decodeCoChange(byRef.get(ref)?.badges?.[COCHANGE_BADGE])) {
            if (own.has(p.ref) || seen.has(p.ref)) continue;
            seen.add(p.ref);
            out.push(p);
            if (out.length >= max) return out;
        }
    }
    return out;
}

/** A partner's name on screen: its path. */
export const partnerName = (ref: string): string => pathOf(ref) || ref;

/** The test files of the partners: a partner that is itself a test, then each test file that references a partner. Paths, sorted. */
export function partnerTests(graph: KnowledgeGraph, partners: readonly CoChangeBadgeEntry[]): string[] {
    if (partners.length === 0) return [];
    const wanted = new Set(partners.map((p) => p.ref as string));
    const tests = new Set<string>();
    for (const ref of wanted) if (fileCategory({ ref: ref as KNode['ref'] }) === 'test') tests.add(ref);
    for (const e of mapEdges(graph)) {
        if (e.kind !== 'references' || !wanted.has(fileRefOf(e.to))) continue;
        const from = fileRefOf(e.from);
        if (fileCategory({ ref: from as KNode['ref'] }) === 'test') tests.add(from);
    }
    return [...tests].map(partnerName).sort();
}
