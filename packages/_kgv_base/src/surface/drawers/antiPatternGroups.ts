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

/** The group a finding folds into: its kind, or for a layer violation the verdict and layer pair. Cheap: one string per finding. */
function idOf(f: Finding): string {
    if (f.kind !== PARTITION_VIOLATION) return f.kind;
    return `${f.kind}:${f.params.verdict === 'upward' ? 'upward' : 'skips'}:${text(f.params.from) ?? ''}>${text(f.params.to) ?? ''}`;
}

/** The group's fields beyond its id, read once from the first finding that opens it. */
function keyOf(f: Finding, id: string): Pick<AntiPatternGroup, 'id' | 'from' | 'to' | 'verdict'> {
    if (f.kind !== PARTITION_VIOLATION) return { id };
    const verdict: Verdict = f.params.verdict === 'upward' ? 'upward' : 'skips';
    const from = text(f.params.from), to = text(f.params.to);
    return { id, verdict, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function groupAntiPatterns(findings: readonly Finding[], opts: GroupOptions = {}): AntiPatternGroup[] {
    const { layer, model } = opts;
    const groups = new Map<string, { group: AntiPatternGroup; touched: Map<string, number> }>();
    for (const f of findings) {
        if (layer && model && findingLayer(f, model) !== layer) continue;
        const id = idOf(f);
        let entry = groups.get(id);
        if (!entry) {
            entry = { group: { ...keyOf(f, id), kind: f.kind, findings: [], files: [], count: 0 }, touched: new Map() };
            groups.set(id, entry);
        }
        entry.group.findings.push(f);
        const tally = entry.touched;
        for (const ref of f.nodes) tally.set(ref, (tally.get(ref) ?? 0) + 1);
    }
    const out: AntiPatternGroup[] = [];
    for (const { group: g, touched } of groups.values()) {
        g.count = g.findings.length;
        g.files = [...touched].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([ref]) => ref);
        out.push(g);
    }
    return out.sort((a, b) => b.count - a.count || cmp(a.id, b.id));
}

/** The kinds the groups hold with their finding totals, biggest first: the list's filter chips. */
export function kindTotals(groups: readonly AntiPatternGroup[]): Array<{ kind: string; count: number }> {
    const by = new Map<string, number>();
    for (const g of groups) by.set(g.kind, (by.get(g.kind) ?? 0) + g.count);
    return [...by].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || cmp(a.kind, b.kind));
}
