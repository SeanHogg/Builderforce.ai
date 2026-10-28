/**
 * The lens registry (PRD 38 §3.3). A lens is a ROW: which packs it applies to, which
 * edges it draws, how it tones a node, its legend and which findings it surfaces as
 * insights. Nothing in the view branches on a lens id except through this table — a new
 * lens is a row here plus its name in `KnowledgeGraphLabels.lenses`.
 */

import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { ThemeTone } from './scene/themeColors';
import type { LensId } from './types';

export type NodeEmphasis = 'strong' | 'normal' | 'dim';

export interface LensDef {
    id: LensId;
    /** Packs it applies to; `'all'` for every pack. */
    packs: readonly string[] | 'all';
    edgeFilter(e: KEdge): boolean;
    nodeStyle(n: KNode): { tone: ThemeTone; emphasis: NodeEmphasis };
    /** Legend entries: a tone and a key into `labels.legend`. */
    legend: ReadonlyArray<{ tone: ThemeTone; key: string }>;
    /** Finding kinds this lens surfaces; `'all'` for every one. */
    insights: readonly string[] | 'all';
    /** The lens needs a model's judgement (an explained empty state without it). */
    needsJudgement?: boolean;
    /** The lens's panel beside the findings. */
    panel?: 'matrix' | 'compare';
}

const KIND_TONE: Record<string, ThemeTone> = {
    file: 'nodeFile', section: 'nodeSection', symbol: 'nodeSymbol', entity: 'nodeEntity', claim: 'nodeClaim',
    fact: 'nodeFact', missing: 'nodeMissing', area: 'plane',
};

export function kindTone(n: KNode): ThemeTone {
    if (n.stale) return 'stale';
    return KIND_TONE[n.kind] ?? 'nodeFile';
}

const base = (n: KNode, strong = false): { tone: ThemeTone; emphasis: NodeEmphasis } =>
    ({ tone: kindTone(n), emphasis: strong ? 'strong' : 'normal' });
const dimUnless = (hit: boolean, n: KNode, tone?: ThemeTone): { tone: ThemeTone; emphasis: NodeEmphasis } =>
    hit ? { tone: tone ?? kindTone(n), emphasis: 'strong' } : { tone: kindTone(n), emphasis: 'dim' };
const isJudged = (n: KNode): boolean => n.origin !== 'extracted';
const isChanged = (n: KNode): boolean => n.badges?.added !== undefined || n.badges?.removed !== undefined || n.badges?.changed !== undefined;
const isUnused = (n: KNode): boolean =>
    n.badges?.unused !== undefined || Number(n.badges?.unusedExports ?? 0) > 0 || Number(n.badges?.unusedDependencies ?? 0) > 0;

const KIND_LEGEND = [
    { tone: 'nodeFile', key: 'file' }, { tone: 'nodeSection', key: 'section' }, { tone: 'nodeEntity', key: 'entity' },
    { tone: 'nodeClaim', key: 'claim' }, { tone: 'nodeFact', key: 'fact' }, { tone: 'stale', key: 'stale' },
] as const satisfies ReadonlyArray<{ tone: ThemeTone; key: string }>;

export const LENSES: Record<LensId, LensDef> = {
    structure: {
        id: 'structure', packs: 'all',
        edgeFilter: (e) => e.origin === 'extracted' && e.kind !== 'duplicate' && e.kind !== 'near-duplicate',
        nodeStyle: (n) => base(n),
        legend: [...KIND_LEGEND, { tone: 'edge', key: 'edge' }],
        insights: ['cycle', 'stale'],
    },
    partitions: {
        id: 'partitions', packs: ['code'],
        edgeFilter: (e) => e.verdict !== undefined || e.cycle === true,
        nodeStyle: (n) => dimUnless(n.partition !== undefined, n),
        legend: [{ tone: 'edge', key: 'edge' }, { tone: 'violation', key: 'violation' }, { tone: 'cycle', key: 'cycle' }],
        insights: ['partition-violation', 'violation', 'unpartitioned', 'unlayered', 'cycle'],
        panel: 'matrix',
    },
    duplication: {
        id: 'duplication', packs: 'all',
        edgeFilter: (e) => e.kind === 'duplicate' || e.kind === 'near-duplicate',
        nodeStyle: (n) => dimUnless(n.badges?.cloneGroup !== undefined, n, 'duplicate'),
        legend: [{ tone: 'duplicate', key: 'duplicate' }],
        insights: ['clone-group', 'near-duplicate', 'possible-same'],
    },
    claims: {
        id: 'claims', packs: ['docs'],
        edgeFilter: (e) => e.kind === 'contradicts' || e.kind === 'agrees' || e.kind === 'about',
        nodeStyle: (n) => dimUnless(n.kind === 'claim', n),
        legend: [{ tone: 'nodeClaim', key: 'claim' }, { tone: 'contradicts', key: 'contradicts' }, { tone: 'agrees', key: 'agrees' }],
        insights: ['contradiction', 'stale'],
        needsJudgement: true,
    },
    links: {
        id: 'links', packs: ['docs'],
        edgeFilter: (e) => e.kind === 'links',
        nodeStyle: (n) => (n.kind === 'missing' ? { tone: 'nodeMissing', emphasis: 'strong' } : base(n)),
        legend: [{ tone: 'nodeFile', key: 'file' }, { tone: 'nodeMissing', key: 'missing' }, { tone: 'edge', key: 'edge' }],
        insights: ['broken-link', 'orphan'],
    },
    unused: {
        id: 'unused', packs: ['code'],
        edgeFilter: (e) => e.kind === 'references',
        nodeStyle: (n) => dimUnless(isUnused(n), n, 'unused'),
        legend: [{ tone: 'unused', key: 'unused' }],
        insights: ['unused', 'unused-file', 'unused-export', 'unused-dependency'],
    },
    knowledge: {
        id: 'knowledge', packs: 'all',
        edgeFilter: (e) => e.kind === 'about' || e.kind === 'mentions' || e.kind === 'supersedes',
        nodeStyle: (n) => dimUnless(isJudged(n), n),
        legend: [...KIND_LEGEND],
        insights: ['stale', 'possible-same'],
    },
    live: {
        id: 'live', packs: ['code'],
        edgeFilter: (e) => e.kind === 'co-changed',
        nodeStyle: (n) => dimUnless(isChanged(n), n, 'changed'),
        legend: [{ tone: 'changed', key: 'changed' }],
        insights: [],
    },
    compare: {
        id: 'compare', packs: 'all',
        edgeFilter: () => true,
        nodeStyle: (n) => base(n),
        legend: [...KIND_LEGEND],
        insights: 'all',
        panel: 'compare',
    },
};

export const LENS_ORDER: readonly LensId[] = [
    'structure', 'partitions', 'duplication', 'claims', 'links', 'unused', 'knowledge', 'live', 'compare',
];

export function lensApplies(lens: LensDef, graph: Pick<KnowledgeGraph, 'scope'>): boolean {
    return lens.packs === 'all' || lens.packs.some((p) => graph.scope.packs.includes(p));
}

/** The lenses a graph offers, in display order. */
export function lensesFor(graph: Pick<KnowledgeGraph, 'scope'>): LensDef[] {
    return LENS_ORDER.map((id) => LENSES[id]).filter((l) => lensApplies(l, graph));
}

/** The findings a lens surfaces. */
export function lensFindings(lens: LensDef, graph: KnowledgeGraph): KnowledgeGraph['findings'] {
    if (lens.insights === 'all') return graph.findings;
    const kinds = new Set(lens.insights);
    return graph.findings.filter((f) => kinds.has(f.kind));
}

/** Whether the graph holds anything a judgement lens could show. */
export function hasJudgement(graph: KnowledgeGraph): boolean {
    return graph.nodes.some(isJudged);
}
