/**
 * The lens registry (PRD 38 §3.3). A lens is a ROW: which packs it applies to, which
 * edges it draws, how it tones a node, its legend and which findings it surfaces as
 * insights. Nothing in the view branches on a lens id except through this table — a new
 * lens is a row here plus its name in `KnowledgeGraphLabels.lenses`.
 */

import { isSymbolEdgeKind, type KEdge, type KNode, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { fileCategory, FILE_CATEGORY_ORDER, type FileCategory } from './fileCategory';
import type { ThemeTone } from './scene/themeColors';
import { nodeShape, typeShape, type NodeShape } from './shapes';
import type { LensId } from './types';

export type NodeEmphasis = 'strong' | 'normal' | 'dim';

/**
 * A node's SHAPE, read beside its colour so two kinds are never told apart by hue alone. The ONE
 * vocabulary (kind → role → shape) is `shapes.ts`; every renderer maps a shape to its own primitive.
 */
export type { NodeShape } from './shapes';

export interface NodeStyle {
    tone: ThemeTone;
    emphasis: NodeEmphasis;
    shape: NodeShape;
}

export interface LensDef {
    id: LensId;
    /** Packs it applies to; `'all'` for every pack. */
    packs: readonly string[] | 'all';
    edgeFilter(e: KEdge): boolean;
    nodeStyle(n: KNode): NodeStyle;
    /** Legend entries: a tone and a key into `labels.legend`; a `shape` draws the glyph beside the swatch. */
    legend: ReadonlyArray<{ tone: ThemeTone; key: string; shape?: NodeShape }>;
    /** Finding kinds this lens surfaces; `'all'` for every one. */
    insights: readonly string[] | 'all';
    /** The lens needs a model's judgement (an explained empty state without it). */
    needsJudgement?: boolean;
    /** The lens's panel beside the findings. */
    panel?: 'matrix' | 'compare';
}

/**
 * The file-category tones (PRD 38's redundant encoding — the 1990 file nodes stop collapsing to one
 * blue). One coherent palette in the view's blue→green arc, each distinct from every NON-file tone on
 * screen: source is the base blue, tests shift cyan, docs teal, config steps to amber (config is the
 * warning family), styles magenta (fact's), data green (entity's), and other stays neutral grey.
 * The lens overrides (violation/cycle/changed/unused/strong) still win: those pass an explicit tone
 * through `dimUnless(..., tone)`/`base`, never the `kindTone` default, and `'dim'` emphasis is set by
 * the emphasis flag, independent of tone. So the category default here only colours what no override
 * claims.
 */
const CATEGORY_TONE: Record<FileCategory, ThemeTone> = {
    source: 'catSource', test: 'catTest', doc: 'catDoc', config: 'catConfig',
    style: 'catStyle', data: 'catData', other: 'catOther',
};

const KIND_TONE: Record<string, ThemeTone> = {
    section: 'nodeSection', symbol: 'nodeSymbol', entity: 'nodeEntity', claim: 'nodeClaim',
    fact: 'nodeFact', missing: 'nodeMissing', area: 'nodeArea',
};

export function kindTone(n: KNode): ThemeTone {
    if (n.stale) return 'stale';
    if (n.kind === 'file') return CATEGORY_TONE[fileCategory(n)];
    return KIND_TONE[n.kind] ?? 'catSource';
}

const base = (n: KNode, strong = false): NodeStyle =>
    ({ tone: kindTone(n), emphasis: strong ? 'strong' : 'normal', shape: nodeShape(n) });
const dimUnless = (hit: boolean, n: KNode, tone?: ThemeTone): NodeStyle =>
    hit ? { tone: tone ?? kindTone(n), emphasis: 'strong', shape: nodeShape(n) } : { tone: kindTone(n), emphasis: 'dim', shape: nodeShape(n) };
const isJudged = (n: KNode): boolean => n.origin !== 'extracted';
const isChanged = (n: KNode): boolean => n.badges?.added !== undefined || n.badges?.removed !== undefined || n.badges?.changed !== undefined;
const isUnused = (n: KNode): boolean =>
    n.badges?.unused !== undefined || Number(n.badges?.unusedExports ?? 0) > 0 || Number(n.badges?.unusedDependencies ?? 0) > 0;

/** The category legend rows, in display order (`FILE_CATEGORY_ORDER`), so the Legend names each file hue. A swatch: the shape key names the shapes. */
const CATEGORY_LEGEND: ReadonlyArray<{ tone: ThemeTone; key: string; shape?: NodeShape }> = FILE_CATEGORY_ORDER.map((cat) => ({
    tone: CATEGORY_TONE[cat], key: `cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}`,
}));

const KIND_LEGEND: ReadonlyArray<{ tone: ThemeTone; key: string; shape?: NodeShape }> = [
    { tone: 'nodeSection', key: 'section', shape: typeShape('section') }, { tone: 'nodeEntity', key: 'entity', shape: typeShape('entity') },
    { tone: 'nodeClaim', key: 'claim', shape: typeShape('claim') }, { tone: 'nodeFact', key: 'fact', shape: typeShape('claim') },
    { tone: 'nodeArea', key: 'area', shape: typeShape('source') }, { tone: 'stale', key: 'stale' },
];

export const LENSES: Record<LensId, LensDef> = {
    structure: {
        id: 'structure', packs: 'all',
        // The symbol-level kinds (PRD 43 P0b: memory's SYMBOL_EDGE_KINDS, the code pack's file rollup) are the class/method
        // bands' link families, not the import picture this lens draws.
        edgeFilter: (e) => e.origin === 'extracted' && e.kind !== 'duplicate' && e.kind !== 'near-duplicate' && !isSymbolEdgeKind(e.kind),
        nodeStyle: (n) => base(n),
        legend: [...CATEGORY_LEGEND, { tone: 'edge', key: 'edge' }],
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
        nodeStyle: (n) => (n.kind === 'missing' ? { tone: 'nodeMissing', emphasis: 'strong', shape: nodeShape(n) } : base(n)),
        legend: [...CATEGORY_LEGEND, { tone: 'nodeMissing', key: 'missing' }, { tone: 'edge', key: 'edge' }],
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
