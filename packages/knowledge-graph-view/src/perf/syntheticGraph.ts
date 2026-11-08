/**
 * A deterministic synthetic KnowledgeGraph shaped like the real user graph that freezes the view
 * (see `PERF_STATS`): a server-truncated graph (3138 nodes, 158,663 edges, 20,738 findings) that carries
 * an outline of 15,960 files, so the map (stations, lines) reads the outline and the scenes read the cut graph.
 * Seeded PRNG only: the same call always gives the same graph. Test-only code (not exported from the package).
 */

import { OUTLINE_BADGE_KEYS } from '@seanhogg/builderforce-memory/knowledge';
import type { Finding, GraphOutline, KEdge, KNode, KnowledgeGraph, NodeRef, OutlineFile } from '@seanhogg/builderforce-memory/knowledge';
import { LAYER_ORDER } from '../surface/layers';

/** The stats the real graph has; `describeGraph` measures them back from the built graph. */
export const PERF_STATS = {
    nodes: 3138, areas: 1138, files: 1990, missing: 10,
    edges: 158_663, references: 158_559, contains: 28, coChanged: 66, links: 10,
    drawnNodes: 2000, drawnEdges: 104_972,
    findings: 20_738, partitionViolation: 20_635, godModule: 100, brokenLink: 1, orphan: 1, unpartitioned: 1,
    outlineFiles: 15_960, stations: 389, entryPoints: 108, unpartitionedShare: 0.36,
    stationLayers: { entry: 108, presentation: 41, application: 38, domain: 101, infrastructure: 6, other: 95 },
} as const;

export const PREFIX = 'src:perf::';
const PARTITIONS = ['application', 'domain', 'entry', 'infrastructure', 'presentation']; // sorted, as an outline holds them
const TOPS = ['Builderforce.ai', '.claude', '.vscode', ''] as const; // '' = a root-level area

function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ref = (path: string): NodeRef => `${PREFIX}${path}` as NodeRef;
const areaRef = (name: string): NodeRef => ref(`area/${name}`);

interface FileRec { path: string; area: number; layer: string | undefined; importance: number; entry: boolean; n: number; badges: Record<string, number | string> }

export interface PerfGraph {
    graph: KnowledgeGraph;
    /** The graph's file nodes (the cut graph keeps these 1990 of the outline's 15,960). */
    graphFiles: KNode[];
    /** The ref of the node with the most in-edges among the cut graph's files. */
    hub: string;
    /** A ref the cut graph does not draw (an area), for `focusGraph(..., keep)`. */
    offBase: string;
}

type Widen<T> = { -readonly [K in keyof T]: T[K] extends number ? number : Widen<T[K]> };
/** The counts a build uses: `PERF_STATS` plus the three sizes the builder derives (areas that hold files, outline links, files in real areas). */
type BuildStats = Widen<typeof PERF_STATS> & { usedAreas: number; outlineLinks: number; realFiles: number };

/**
 * The build counts at `scale` (1 = exactly `PERF_STATS`). Every count that sets the SIZE of the graph shrinks proportionally
 * (at least 1); the few tiny structural ones stay as they are: `missing`, `links` and the single broken-link / orphan /
 * unpartitioned findings, and the per-area file counts (20 in a layered area, 40 in an unlayered one). The unpartitioned share
 * stays 36%. Edge and finding totals are NOT re-derived from each other: they scale independently by the same factor, so
 * their ratios hold to rounding.
 */
function buildStats(scale: number): BuildStats {
    const n = (v: number): number => (scale === 1 ? v : Math.max(1, Math.round(v * scale)));
    const L = PERF_STATS.stationLayers;
    const layers = { entry: n(L.entry), presentation: n(L.presentation), application: n(L.application), domain: n(L.domain), infrastructure: n(L.infrastructure), other: n(L.other) };
    const usedAreas = layers.presentation + layers.application + layers.domain + layers.infrastructure + layers.other;
    const S = PERF_STATS;
    return {
        nodes: n(S.nodes), areas: Math.max(n(S.areas), usedAreas + 1), files: n(S.files), missing: S.missing,
        edges: n(S.edges), references: n(S.references), contains: n(S.contains), coChanged: n(S.coChanged), links: S.links,
        drawnNodes: n(S.drawnNodes), drawnEdges: n(S.drawnEdges),
        findings: n(S.findings), partitionViolation: n(S.partitionViolation), godModule: n(S.godModule),
        brokenLink: S.brokenLink, orphan: S.orphan, unpartitioned: S.unpartitioned,
        outlineFiles: n(S.outlineFiles), entryPoints: n(S.entryPoints), unpartitionedShare: S.unpartitionedShare,
        stationLayers: layers, stations: n(S.stations),
        usedAreas: scale === 1 ? 281 : usedAreas, // 389 stations = 281 areas + 108 entry splits
        outlineLinks: n(150_000), realFiles: n(12_160),
    };
}

export interface PerfGraphOptions {
    /** Shrinks the graph proportionally (0 < scale <= 1, default 1 = the real graph's size, exactly). */
    scale?: number;
}

export function buildPerfGraph(opts: PerfGraphOptions = {}): PerfGraph {
    const scale = opts.scale ?? 1;
    const P = buildStats(scale);
    const r = rng(0x5eed);

    // Areas: 95 'other' (no layer), the rest spread over the layers as the real stations are.
    const layers: Array<string | undefined> = [];
    const L = P.stationLayers;
    for (const [layer, n] of [['domain', L.domain], ['presentation', L.presentation], ['application', L.application], ['infrastructure', L.infrastructure]] as const) for (let i = 0; i < n; i++) layers.push(layer);
    for (let i = 0; i < L.other; i++) layers.push(undefined);
    for (let i = layers.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [layers[i], layers[j]] = [layers[j], layers[i]]; }

    // Sizes: an 'other' area has 40 files; the rest share 12,160 by a power law (20 each at least). Sum = 15,960.
    const real = layers.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
    const extraTotal = P.realFiles - real.length * 20;
    const weight = real.map((_, k) => 1 / (k + 2) ** 0.8);
    const wsum = weight.reduce((a, b) => a + b, 0);
    const sizes = layers.map(() => 40);
    let used = 0;
    real.forEach((area, k) => { const s = 20 + Math.floor((extraTotal * weight[k]!) / wsum); sizes[area] = s; used += s; });
    sizes[real[0]!]! += P.realFiles - used;

    const entryAreas = new Set(Array.from({ length: P.entryPoints }, (_, j) => Math.floor((j * P.usedAreas) / P.entryPoints)));
    const areaBase = (i: number): string => {
        const top = TOPS[i % 10 < 6 ? 0 : i % 10 < 8 ? 1 : i % 10 < 9 ? 2 : 3];
        return top === '' ? `scripts${i}` : `${top}/pkg${i % 23}/area${i}`;
    };

    const recs: FileRec[] = [];
    const owners = ['platform', 'web', 'api', 'data', 'infra', 'growth'];
    for (let a = 0; a < P.usedAreas; a++) {
        for (let n = 0; n < sizes[a]!; n++) {
            const entry = n === 0 && entryAreas.has(a);
            const bucket = n % 7 === 0 ? '' : `s${n % 6}/`;
            const badges: Record<string, number | string> = { complexity: 1 + Math.floor(r() * 40) };
            if (r() < 0.7) badges.coverage = Math.round(r() * 100) / 100;
            if (r() < 0.8) badges.churn = Math.floor(r() ** 3 * 60);
            if (r() < 0.6) badges.owner = owners[Math.floor(r() * owners.length)]!;
            if (r() < 0.05 && layers[a] === 'presentation') badges.routes = 'GET /v1/items;POST /v1/items';
            recs.push({
                path: `${areaBase(a)}/${bucket}f${n}.ts`, area: a, layer: entry ? 'entry' : layers[a], n, entry,
                importance: entry ? 0.8 + 0.2 * r() : 0.02 + 0.98 * r() ** 2, badges,
            });
        }
    }
    // Exactly 36% of the files are unpartitioned: 'other' areas already are; flip more from the tail (never an entry, never an area's first file).
    const target = Math.round(P.unpartitionedShare * recs.length);
    let loose = recs.filter((f) => f.layer === undefined).length;
    for (let i = recs.length - 1; i >= 0 && loose < target; i--) {
        const f = recs[i]!;
        if (f.layer === undefined || f.entry || f.n === 0) continue;
        f.layer = undefined; loose++;
    }

    // The outline: files sorted by ref (their indexes are the links' ends).
    const sorted = [...recs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const slot = new Map<FileRec, number>(sorted.map((f, i) => [f, i] as const));
    const areaRefs = Array.from({ length: P.usedAreas }, (_, i) => areaRef(`A${i}`));
    const outlineFiles: OutlineFile[] = sorted.map((f) => {
        const badges: Record<string, number | string> = {};
        for (const k of OUTLINE_BADGE_KEYS) if (f.badges[k] !== undefined) badges[k] = f.badges[k]!;
        return {
            path: f.path, area: f.area, ...(f.layer ? { partition: PARTITIONS.indexOf(f.layer) } : {}), importance: f.importance,
            ...(Object.keys(badges).length ? { badges } : {}),
        };
    });

    // Links: a few hubs with thousands of in-edges; 60% go one layer down so the entry routes have somewhere to go.
    const rank = (f: FileRec): number => (f.layer ? LAYER_ORDER.indexOf(f.layer as (typeof LAYER_ORDER)[number]) : -1);
    const pools: number[][] = [[], [], [], [], []];
    sorted.forEach((f, i) => { const k = rank(f); if (k >= 0) pools[k]!.push(i); });
    const entries = pools[0]!;
    const pick = (list: readonly number[], skew: number): number => list[Math.floor(list.length * r() ** skew)]!;
    const seen = new Set<number>();
    const links: Array<[number, number, number, number]> = [];
    while (links.length < P.outlineLinks) {
        const from = r() < 0.05 ? pick(entries, 1) : Math.floor(sorted.length * r() ** 1.4);
        const k = rank(sorted[from]!);
        const to = k >= 0 && k < 4 && r() < 0.6 ? pick(pools[k + 1]!, 2.5) : Math.floor(sorted.length * r() ** 2.5);
        const key = from * sorted.length + to;
        if (from === to || seen.has(key)) continue;
        seen.add(key);
        const a = rank(sorted[from]!), b = rank(sorted[to]!);
        const code = a < 0 || b < 0 ? 0 : a === b ? 1 : b - a === 1 ? 2 : b > a ? 3 : 4;
        links.push([from, to, code, code === 4 && r() < 0.3 ? 1 : 0]);
    }
    links.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const outline: GraphOutline = { prefix: PREFIX, areas: areaRefs, partitions: PARTITIONS, files: outlineFiles, links, capped: false };

    // The cut graph: the 1990 most important files, every area node, 10 missing targets.
    const top = [...sorted].sort((a, b) => b.importance - a.importance || (a.path < b.path ? -1 : 1)).slice(0, P.files);
    const fileNode = (f: FileRec, godModule: boolean): KNode => ({
        ref: ref(f.path), kind: 'file', label: f.path.slice(f.path.lastIndexOf('/') + 1), pack: 'code', ...(f.layer ? { partition: f.layer } : {}),
        area: areaRefs[f.area]!, importance: f.importance, origin: 'extracted', sourceHash: `h${slot.get(f)}`,
        badges: godModule ? { ...f.badges, patterns: 'god-module', lines: 900, exports: 40 } : f.badges,
    });
    const godAt = new Set(Array.from({ length: P.godModule }, (_, i) => i * 19));
    const graphFiles = top.map((f, i) => fileNode(f, godAt.has(i)));
    const areaNodes: KNode[] = Array.from({ length: P.areas }, (_, i) => ({
        ref: i < P.usedAreas ? areaRefs[i]! : areaRef(`X${i}`), kind: 'area', label: i < P.usedAreas ? `Area ${i}` : `Extra ${i}`, pack: 'code',
        importance: 0.001 + 0.009 * r(), origin: 'extracted',
    }));
    const missing: KNode[] = Array.from({ length: P.missing }, (_, i) => ({
        ref: ref(`docs/missing${i}.md`), kind: 'missing', label: `missing${i}.md`, pack: 'docs', importance: 0.5, origin: 'extracted',
    }));

    // Edges: hubs by a skewed pick (a few files take thousands of in-edges); the rest of the references point at areas.
    const gf = graphFiles.map((n) => n.ref);
    const edge = (from: string, to: string, kind: string, extra: Partial<KEdge> = {}): KEdge => ({ from: from as NodeRef, to: to as NodeRef, kind, weight: 1, origin: 'extracted', ...extra });
    const fileRefs = P.drawnEdges - P.coChanged - P.links;
    const inDegree = new Map<string, number>();
    const edges: KEdge[] = [];
    const findings: Finding[] = [];
    const ids = new Set<string>();
    const fid = (kind: string, nodes: string[]): string => {
        const base = `${kind}:${nodes.join('|')}`;
        let id = base;
        for (let n = 2; ids.has(id); n++) id = `${base}#${n}`;
        ids.add(id);
        return id;
    };
    const partOf = new Map(graphFiles.map((n) => [n.ref as string, n.partition ?? ''] as const));
    let acc = 0;
    for (let i = 0; i < fileRefs; i++) {
        let from = gf[Math.floor(gf.length * r() ** 1.4)]!, to = gf[Math.floor(gf.length * r() ** 2.5)]!;
        if (from === to) { from = gf[(gf.indexOf(from) + 1) % gf.length]!; }
        inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
        acc += P.partitionViolation;
        if (acc >= fileRefs) {
            acc -= fileRefs;
            const verdict = i % 10 < 7 ? 'skips' : 'upward';
            edges.push(edge(from, to, 'references', { verdict, ...(verdict === 'upward' && i % 3 === 0 ? { cycle: true } : {}) }));
            findings.push({
                id: fid('partition-violation', [from, to]), kind: 'partition-violation', pack: 'code', nodes: [from as NodeRef, to as NodeRef],
                severity: verdict === 'upward' ? 'error' : 'warn', params: { verdict, from: partOf.get(from) ?? '', to: partOf.get(to) ?? '', kind: 'references' },
                requestKey: 'knowledgeGraph.fix.partitionViolation',
            });
        } else {
            edges.push(edge(from, to, 'references', i % 5 === 0 ? {} : { verdict: i % 5 < 3 ? 'allowed' : 'same' }));
        }
    }
    const toArea = P.references - fileRefs;
    for (let i = 0; i < toArea; i++) edges.push(edge(gf[Math.floor(gf.length * r())]!, areaNodes[Math.floor(areaNodes.length * r() ** 2)]!.ref, 'references'));
    for (let i = 0; i < P.coChanged; i++) edges.push(edge(gf[(i * 7) % gf.length]!, gf[(i * 13 + 5) % gf.length]!, 'co-changed', { weight: 0.5 }));
    for (let i = 0; i < P.links; i++) edges.push(edge(gf[i * 3]!, missing[i]!.ref, 'links'));
    for (let i = 0; i < P.contains; i++) edges.push(edge(areaNodes[i]!.ref, gf[i * 11]!, 'contains'));

    for (let i = 0; i < P.godModule; i++) {
        const n = graphFiles[i * 19]!;
        findings.push({ id: fid('god-module', [n.ref]), kind: 'god-module', pack: 'code', nodes: [n.ref], severity: 'warn', params: { lines: 900, exports: 40, complexity: 80, linesLimit: 500, exportsLimit: 20, complexityLimit: 50 }, requestKey: 'knowledgeGraph.fix.godModule' });
    }
    findings.push({ id: fid('broken-link', [gf[0]!, missing[0]!.ref]), kind: 'broken-link', pack: 'docs', nodes: [gf[0]! as NodeRef, missing[0]!.ref], severity: 'warn', params: { target: 'missing0.md' }, requestKey: 'knowledgeGraph.fix.brokenLink' });
    findings.push({ id: fid('orphan', [gf[1]!]), kind: 'orphan', pack: 'docs', nodes: [gf[1]! as NodeRef], severity: 'info', params: {}, requestKey: 'knowledgeGraph.fix.orphan' });
    const looseRefs = graphFiles.filter((n) => n.partition === undefined).map((n) => n.ref);
    findings.push({
        id: fid('unpartitioned', [`${looseRefs.length}`]), kind: 'unpartitioned', pack: 'code', nodes: looseRefs, severity: 'info',
        params: { count: looseRefs.length, total: graphFiles.length, share: Math.round((looseRefs.length / graphFiles.length) * 100) }, requestKey: 'knowledgeGraph.fix.unpartitioned',
    });

    const nodes = [...areaNodes, ...graphFiles, ...missing];
    const graph: KnowledgeGraph = {
        scope: { rootId: 'perf', packs: ['code'], digest: 'd:perf' }, nodes, edges, findings,
        stats: { sources: outlineFiles.length, nodes: nodes.length, edges: edges.length, stale: 0, truncated: true },
        outline,
    };
    const hub = [...inDegree].sort((a, b) => b[1] - a[1])[0]![0];
    return { graph, graphFiles, hub, offBase: areaNodes[P.usedAreas]!.ref };
}

/** The numbers `PERF_STATS` names, measured from a built graph (the test asserts they match). */
export function describeGraph(g: KnowledgeGraph): Record<string, number> {
    const count = <T>(items: readonly T[], key: (t: T) => string, value: string): number => items.filter((i) => key(i) === value).length;
    const inLevel = new Map<string, number>();
    for (const e of g.edges) inLevel.set(e.to, (inLevel.get(e.to) ?? 0) + 1);
    const files = g.outline!.files;
    return {
        nodes: g.nodes.length, areas: count(g.nodes, (n) => n.kind, 'area'), files: count(g.nodes, (n) => n.kind, 'file'), missing: count(g.nodes, (n) => n.kind, 'missing'),
        edges: g.edges.length, references: count(g.edges, (e) => e.kind, 'references'), contains: count(g.edges, (e) => e.kind, 'contains'),
        coChanged: count(g.edges, (e) => e.kind, 'co-changed'), links: count(g.edges, (e) => e.kind, 'links'),
        findings: g.findings.length, partitionViolation: count(g.findings, (f) => f.kind, 'partition-violation'), godModule: count(g.findings, (f) => f.kind, 'god-module'),
        brokenLink: count(g.findings, (f) => f.kind, 'broken-link'), orphan: count(g.findings, (f) => f.kind, 'orphan'), unpartitioned: count(g.findings, (f) => f.kind, 'unpartitioned'),
        outlineFiles: files.length, entryPoints: files.filter((f) => g.outline!.partitions[f.partition ?? -1] === 'entry').length,
        unpartitionedPct: Math.round((files.filter((f) => f.partition === undefined).length / files.length) * 100),
        maxInDegree: Math.max(...inLevel.values()),
    };
}
