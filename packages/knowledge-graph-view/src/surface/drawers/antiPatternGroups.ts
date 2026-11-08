/**
 * The Patterns drawer's anti-pattern groups: 20,000 layer-violation findings fold into one group
 * per verdict and layer pair, every other kind into one group per kind. One pass over the findings
 * (O(n)); sorted by size then id so the order is deterministic. Pure; the drawer only draws it.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import type { StationModel } from '../stations';
import { findingLayer } from './patternsModel';

export const PARTITION_VIOLATION = 'partition-violation';

export type Verdict = 'upward' | 'skips';

export interface AntiPatternGroup {
    id: string;
    kind: string;
    /** Layer violations only: the partition that reaches, the one it reaches into, and how. */
    from?: string;
    to?: string;
    verdict?: Verdict;
    findings: Finding[];
    /** Unique file refs the findings touch, the ones touched by the most findings first. */
    files: string[];
    count: number;
}

export interface GroupOptions {
    /** Keep only the findings of this layer (the matrix's Anti-pattern cell). Needs `model`. */
    layer?: string | null | undefined;
    model?: Pick<StationModel, 'stationOf' | 'byId'> | undefined;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function keyOf(f: Finding): Pick<AntiPatternGroup, 'id' | 'from' | 'to' | 'verdict'> {
    if (f.kind !== PARTITION_VIOLATION) return { id: f.kind };
    const verdict: Verdict = f.params.verdict === 'upward' ? 'upward' : 'skips';
    const from = text(f.params.from), to = text(f.params.to);
    return { id: `${f.kind}:${verdict}:${from ?? ''}>${to ?? ''}`, verdict, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function groupAntiPatterns(findings: readonly Finding[], opts: GroupOptions = {}): AntiPatternGroup[] {
    const { layer, model } = opts;
    const groups = new Map<string, AntiPatternGroup>();
    const touched = new Map<string, Map<string, number>>();
    for (const f of findings) {
        if (layer && model && findingLayer(f, model) !== layer) continue;
        const key = keyOf(f);
        let g = groups.get(key.id);
        if (!g) {
            g = { ...key, kind: f.kind, findings: [], files: [], count: 0 };
            groups.set(key.id, g);
            touched.set(key.id, new Map());
        }
        g.findings.push(f);
        const tally = touched.get(key.id)!;
        for (const ref of f.nodes) tally.set(ref, (tally.get(ref) ?? 0) + 1);
    }
    for (const g of groups.values()) {
        g.count = g.findings.length;
        g.files = [...touched.get(g.id)!].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([ref]) => ref);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || cmp(a.id, b.id));
}

/** The kinds the groups hold with their finding totals, biggest first: the list's filter chips. */
export function kindTotals(groups: readonly AntiPatternGroup[]): Array<{ kind: string; count: number }> {
    const by = new Map<string, number>();
    for (const g of groups) by.set(g.kind, (by.get(g.kind) ?? 0) + g.count);
    return [...by].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || cmp(a.kind, b.kind));
}
