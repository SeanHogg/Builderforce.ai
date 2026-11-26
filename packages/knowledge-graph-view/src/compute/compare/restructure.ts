/**
 * Restructure proposals (PRD 43 Part C6): for a finding of an anti-pattern kind, the graph as it would be AFTER the
 * fix, plus where each new node grows out of. One ROW per kind in {@link PROPOSERS}; a kind has a Restructure action
 * iff it is there. Proposals are never written: Apply goes through the existing fix flow. Pure and worker-safe (no
 * labels, no React; `surface/layers` is a pure table).
 *
 * god-module: the finding names the FILE. Its definitions and their internal `calls`/`uses` edges (from
 * `SymbolRecord.relations`) give cohesive groups; each group becomes a module node beside the file. New refs are
 * `<file ref minus ext>.<lead><ext>` (`src:r::api/big.ts` → `src:r::api/big.fetchUsers.ts`, `lead` = the group's first
 * exported definition, de-duplicated with `-2`…): path-like, so `pathOf` / `markTypeOf` read them as files, and in the
 * same folder, so the file's station keeps them. The file itself is replaced.
 */

import { fileRefOf, type Finding, type KEdge, type KnowledgeGraph, type KNode, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex, pathOf } from '../../graphModel';
import { cmp } from '../../order';
import { LAYER_ORDER, layerRank } from '../../surface/layers';
import type { SymbolRecord } from '../../types';

export type Proposal = { after: KnowledgeGraph; bornFrom: Map<string, string> };
export type Proposer = (graph: KnowledgeGraph, finding: Finding, symbols: readonly SymbolRecord[]) => Proposal | null;

const sameKey = (e: Pick<KEdge, 'from' | 'to' | 'kind'>): string => `${e.from}\u0000${e.to}\u0000${e.kind}`;

/** The graph with these nodes, edges and findings, its counts kept true. */
const rebuilt = (g: KnowledgeGraph, nodes: KNode[], edges: KEdge[], findings: Finding[]): KnowledgeGraph =>
    ({ ...g, nodes, edges, findings, stats: { ...g.stats, nodes: nodes.length, edges: edges.length } });

/** Edges deduped by (from, to, kind), first wins, self-edges dropped. */
function dedupe(edges: KEdge[]): KEdge[] {
    const seen = new Set<string>();
    return edges.filter((e) => {
        const k = sameKey(e);
        if (e.from === e.to || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// ── partition-violation ────────────────────────────────────────────────────────────────────────────────────────────

/** The edge that climbs a layer is removed and routed through the layer between, or dropped when there is none. */
const partitionViolation: Proposer = (graph, finding) => {
    const [from, to] = finding.nodes;
    if (!from || !to) return null;
    const kind = String(finding.params['kind'] ?? 'references');
    const climbs = (e: KEdge): boolean => e.from === from && e.to === to && e.kind === kind;
    const original = graph.edges.find(climbs);
    if (!original) return null;

    const index = nodeIndex(graph);
    const a = layerRank(String(finding.params['from'] ?? index.get(from)?.partition));
    const b = layerRank(String(finding.params['to'] ?? index.get(to)?.partition));
    let via: KNode | undefined;
    if (a !== undefined && b !== undefined && Math.abs(a - b) > 1) {
        const layer = LAYER_ORDER[a + Math.sign(b - a)];
        const area = index.get(to)?.area;
        via = graph.nodes
            .filter((n) => n.kind === 'file' && n.partition === layer && n.ref !== from && n.ref !== to)
            .sort((x, y) => Number(y.area === area) - Number(x.area === area) || y.importance - x.importance || cmp(x.ref, y.ref))[0];
    }
    const hop = (s: NodeRef, t: NodeRef): KEdge => ({ from: s, to: t, kind, weight: original.weight, origin: original.origin, verdict: 'allowed' });
    const edges = dedupe([...graph.edges.filter((e) => !climbs(e)), ...(via ? [hop(from, via.ref), hop(via.ref, to)] : [])]);
    return { after: rebuilt(graph, graph.nodes, edges, graph.findings.filter((f) => f.id !== finding.id)), bornFrom: new Map() };
};

// ── god-module ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A top-level definition and the members hanging off it, with the line it starts on. */
interface Unit { ref: string; name: string; line: number; exported: boolean; members: Set<string> }

const COHESIVE_KINDS: ReadonlySet<string> = new Set(['calls', 'uses']);
const noAt = (ref: string): string => ref.replace(/@\d+$/, '');

/** The file's top-level definitions, each owning its members (a class and its methods are ONE unit). */
function unitsOf(file: string, symbols: readonly SymbolRecord[]): Map<string, Unit> {
    const own = symbols.filter((s) => fileRefOf(s.ref as NodeRef) === file);
    const parentOf = new Map(own.map((s) => [s.ref, s.parent] as const));
    const units = new Map<string, Unit>();
    for (const s of own) if (s.parent === file) units.set(s.ref, { ref: s.ref, name: s.name, line: s.line, exported: s.exported, members: new Set([s.ref]) });
    for (const s of own) {
        let at = s.parent;
        for (let hops = 0; at !== file && !units.has(at) && hops < 8; hops++) at = parentOf.get(at) ?? file;
        units.get(at)?.members.add(s.ref);
    }
    return units;
}

/** Connected components of the units over internal `calls`/`uses`; the pairs' counts say how tightly two units are tied. */
function groupsOf(symbols: readonly SymbolRecord[], units: Map<string, Unit>): Unit[][] {
    const unitOf = new Map<string, Unit>(), byBare = new Map<string, Unit>();
    for (const u of units.values()) for (const m of u.members) { unitOf.set(m, u); byBare.set(noAt(m), u); }
    const parent = new Map<Unit, Unit>([...units.values()].map((u) => [u, u] as const));
    const find = (u: Unit): Unit => { let r = u; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
    for (const s of symbols) {
        const from = unitOf.get(s.ref);
        if (!from) continue;
        for (const r of s.relations ?? []) {
            const to = unitOf.get(r.to) ?? byBare.get(noAt(r.to));
            if (COHESIVE_KINDS.has(r.kind) && to && to !== from) parent.set(find(to), find(from));
        }
    }
    const comps = new Map<Unit, Unit[]>();
    for (const u of [...units.values()].sort((a, b) => a.line - b.line || cmp(a.ref, b.ref))) {
        const root = find(u);
        comps.set(root, [...(comps.get(root) ?? []), u]);
    }
    const all = [...comps.values()];
    const cores = all.filter((c) => c.length > 1);
    // A definition tied to nothing joins the core holding its nearest neighbour by line (what reads as beside it).
    for (const lone of all.filter((c) => c.length === 1)) {
        const u = lone[0]!;
        const near = cores.map((c) => ({ c, d: Math.min(...c.map((m) => Math.abs(m.line - u.line))) })).sort((x, y) => x.d - y.d)[0];
        near?.c.push(u);
    }
    return cores.map((c) => c.sort((a, b) => a.line - b.line || cmp(a.ref, b.ref))).sort((a, b) => a[0]!.line - b[0]!.line);
}

const sanitize = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '') || 'part';

/** `src:r::api/big.ts` + `fetchUsers` → `src:r::api/big.fetchUsers.ts`. */
function moduleRef(file: string, lead: string, taken: ReadonlySet<string>): string {
    const path = pathOf(file as NodeRef) ?? file;
    const dot = path.lastIndexOf('.');
    const cut = dot > path.lastIndexOf('/') + 1 ? dot : path.length;
    const prefix = file.slice(0, file.length - path.length);
    let ref = `${prefix}${path.slice(0, cut)}.${sanitize(lead)}${path.slice(cut)}`;
    for (let n = 2; taken.has(ref); n++) ref = `${prefix}${path.slice(0, cut)}.${sanitize(lead)}-${n}${path.slice(cut)}`;
    return ref;
}

const tail = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
/** The measures that made it a god module do not carry over to its parts. */
const SIZE_BADGES = new Set(['lines', 'exports', 'complexity', 'maxComplexity']);

/** Each cohesive group of the file's definitions becomes a module `bornFrom` the file; edges follow the definitions. */
const godModule: Proposer = (graph, finding, symbols) => {
    const file = finding.nodes[0];
    const fileNode = file && graph.nodes.find((n) => n.ref === file);
    if (!file || !fileNode) return null;
    const units = unitsOf(file, symbols);
    const groups = groupsOf(symbols, units);
    if (groups.length < 2) return null;
    const total = [...units.values()].reduce((n, u) => n + u.members.size, 0);

    const taken = new Set<string>(graph.nodes.map((n) => n.ref));
    const owner = new Map<string, string>(), size = new Map<string, number>();
    const modules: KNode[] = groups.map((g) => {
        const lead = (g.find((u) => u.exported) ?? g[0]!).name;
        const ref = moduleRef(file, lead, taken);
        taken.add(ref);
        for (const u of g) for (const m of u.members) owner.set(noAt(m), ref);
        const members = g.reduce((n, u) => n + u.members.size, 0);
        size.set(ref, members);
        const path = pathOf(ref as NodeRef) ?? ref;
        const badges = Object.fromEntries(Object.entries(fileNode.badges ?? {}).filter(([k]) => !SIZE_BADGES.has(k) && k !== 'patterns'));
        const { sourceHash: _derived, ...rest } = fileNode; // a new file has no hash of its own yet
        return { ...rest, ref: ref as NodeRef, label: relabel(fileNode.label, file, ref), badges, importance: fileNode.importance * members / Math.max(1, total) };
    });
    const primary = [...modules].sort((a, b) => size.get(b.ref)! - size.get(a.ref)! || cmp(a.ref, b.ref))[0]!.ref;
    const ownerOf = (to: string): string | undefined => owner.get(noAt(to));

    // Cross-group relations are the modules' own edges; outside targets come from the group whose definition reaches them.
    const inner: KEdge[] = [], reach = new Map<string, Set<string>>();
    for (const s of symbols) {
        const from = ownerOf(s.ref);
        if (!from) continue;
        for (const r of s.relations ?? []) {
            const to = ownerOf(r.to);
            if (to && to !== from) inner.push({ from: from as NodeRef, to: to as NodeRef, kind: 'references', weight: 1, origin: 'extracted', verdict: 'same' });
            else if (!to) { const t = fileRefOf(r.to as NodeRef); reach.set(t, (reach.get(t) ?? new Set()).add(from)); }
        }
    }
    const outside: KEdge[] = [];
    for (const e of graph.edges) {
        const a = fileRefOf(e.from) === file, b = fileRefOf(e.to) === file;
        if (!a && !b) { outside.push(e); continue; }
        if (a && b) continue;
        const owners = a ? ownerOf(e.from) : ownerOf(e.to);
        if (b) for (const m of owners ? [owners] : modules.map((x) => x.ref)) outside.push({ ...e, to: m as NodeRef });
        else for (const m of owners ? [owners] : [...(reach.get(fileRefOf(e.to)) ?? [primary])]) outside.push({ ...e, from: m as NodeRef });
    }
    const at = graph.nodes.indexOf(fileNode);
    const nodes = [...graph.nodes.slice(0, at), ...modules, ...graph.nodes.slice(at + 1)];
    const findings = graph.findings.filter((f) => f.id !== finding.id)
        .map((f) => (f.nodes.includes(file) ? { ...f, nodes: f.nodes.map((n) => (n === file ? (primary as NodeRef) : n)) } : f));
    return { after: rebuilt(graph, nodes, dedupe([...outside, ...inner]), findings), bornFrom: new Map(modules.map((m) => [m.ref, file])) };
};

/** One row per restructurable kind (the Restructure action exists iff the kind is here). */
export const PROPOSERS: Readonly<Record<string, Proposer>> = {
    'partition-violation': partitionViolation,
    'god-module': godModule,
};

/** Kinds whose proposer reads the file's symbols: the action stays disabled until `symbolsOf` has loaded them. */
const NEEDS_SYMBOLS: ReadonlySet<string> = new Set(['god-module']);

export const isRestructurable = (kind: string): boolean => Object.hasOwn(PROPOSERS, kind);
export const needsSymbols = (kind: string): boolean => NEEDS_SYMBOLS.has(kind);

export function proposeRestructure(graph: KnowledgeGraph, finding: Finding, symbols: readonly SymbolRecord[]): Proposal | null {
    return isRestructurable(finding.kind) ? PROPOSERS[finding.kind]!(graph, finding, symbols) : null;
}
