/**
 * Stations: the graph folded to the size a person can read (PRD 38, Option B+). One station
 * per `area` node; files without an area are grouped by their top folder. A mixed station
 * (entry files beside other layers) splits its entry files into their own station, so an
 * entry point stands on the map where a request begins.
 *
 * Each station carries rolled-up metrics. A metric whose data is absent is `undefined`, never
 * zero: coverage that was not collected is "not set up", not "0% covered" (PRD: "a source that
 * is not set up shows that state. It never shows invented numbers").
 */

import type { Finding, KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex, pathOf } from '../graphModel';
import { cmp } from '../order';
import { dataCoverage, hasMeasuredCoverage } from './dataCoverage';
import { LAYER_ORDER, layerRank, type Provenance } from './layers';
import { rollUpAreas, type Group } from './areaRollup';
import { fileNodesOf, outlineView } from './outlineGraph';
import { reachOf, staticReach } from './staticReach';
import { isRepoConfigFile, REPO_CONFIG_NAME, stationNames } from './stationName';
import { appOfNode, copyMap, foldedSystem, systemOfNode, systemsOf } from './systems';

export interface Station {
    id: string;
    /** The short name shown everywhere (`stationName`); the full path is {@link path}. */
    name: string;
    /** The full path or label the name was cut from: the tooltip and the accessible name. */
    path?: string;
    kind: 'area' | 'folder';
    /** Holds (or is made of) files of the `entry` partition. */
    entry: boolean;
    /** The member file refs. */
    refs: string[];
    files: number;
    /** The partition most of its files are in. */
    layer?: string;
    /** 1 (clean) to 5, from the severity and number of the findings that touch it. */
    anti: number;
    findingIds: string[];
    /** Complexity, 1–5 by quantile among stations that have it; undefined = no complexity data. */
    cx?: number;
    /**
     * Mean line coverage 0–1 over the files that report it; undefined = no coverage data. When no
     * file of the graph carries a coverage badge it is the share of its files a test REACHES over
     * `references` edges (see `staticReach`), and {@link covProvenance} is `heuristic`.
     */
    cov?: number;
    /** `runtime` = measured by a coverage report; `heuristic` = static reach. Set whenever {@link cov} is. */
    covProvenance?: Provenance;
    /** Importance relative to the busiest station, 0–1. */
    use: number;
    /** Commits in 90 days relative to the most-changed station, 0–1; undefined = no history. */
    churn?: number;
    changed: boolean;
    owner?: string;
    patterns: string[];
    /** Distinct clone groups its files belong to. */
    dup: number;
    unused: number;
    /** Facts and claims remembered about its files. */
    facts: number;
    claims: number;
    /** The system most of its files belong to (PRD 41 A9); a stray copy reads as its original. Absent on a single-system root. */
    system?: string;
    /** The app (workspace package) of that system most of its files belong to. */
    app?: string;
    /** Set when the station is in a stray copy of a system: the copy's own folder. */
    copy?: string;
}

export interface StationModel {
    stations: Station[];
    byId: Map<string, Station>;
    /** File ref → station id (also an area ref and the claims and facts about a file). Sections and symbols resolve through {@link stationOfRef}. */
    stationOf: Map<string, string>;
    /** Ids of the findings that touch more than {@link SYSTEM_WIDE_SHARE} of the stations: counted on no single station (see {@link systemWideFindings}). */
    systemWide?: ReadonlySet<string>;
    /** Set when the outline itself was capped: the map shows `shown` of about `total` files. */
    capped?: { shown: number; total: number };
}

export interface StationOptions {
    /** Refs known to have changed (from the compare baseline, a live run or the time slider). */
    changed?: ReadonlySet<string>;
    /** What the top-level config station is called (the host's `surface.repoConfig` label); absent ⇒ the English {@link REPO_CONFIG_NAME}. */
    repoConfigName?: string;
}

const SEVERITY_WEIGHT = { error: 3, warn: 2, info: 1 } as const;

/** A finding touching more than this share of the stations is about the system, not about any one station. */
export const SYSTEM_WIDE_SHARE = 0.25;
/** The share means nothing on a handful of stations (one finding over two of five is not "system-wide"). */
export const SYSTEM_WIDE_MIN_STATIONS = 8;

/** The system-wide findings, for the top of the Act rail. THE one rule: stations carry no count for them. */
export function systemWideFindings(model: Pick<StationModel, 'systemWide'>, findings: readonly Finding[]): Finding[] {
    const wide = model.systemWide;
    return wide && wide.size > 0 ? findings.filter((f) => wide.has(f.id)) : [];
}

const num = (v: number | string | undefined): number | undefined => {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

/** 0 → 1 … >7 → 5 over the weighted findings of a station. */
export function antiLevel(score: number): number {
    return score <= 0 ? 1 : score <= 1 ? 2 : score <= 3 ? 3 : score <= 7 ? 4 : 5;
}

/** The file ref a section or symbol ref belongs to. */
export function fileRefOf(ref: string): string {
    const hash = ref.indexOf('#');
    return hash >= 0 ? ref.slice(0, hash) : ref;
}

export function stationOfRef(model: Pick<StationModel, 'stationOf'>, ref: string): string | undefined {
    return model.stationOf.get(ref) ?? model.stationOf.get(fileRefOf(ref));
}

const tail = (ref: string): string => {
    const at = ref.indexOf('::');
    const path = at >= 0 ? ref.slice(at + 2) : ref;
    return path.slice(path.lastIndexOf('/') + 1) || path;
};


function baseGroups(files: KNode[], index: ReadonlyMap<string, KNode>, repoConfigName: string): Map<string, Group> {
    const groups = new Map<string, Group>();
    for (const n of files) {
        let id: string, name: string, kind: Station['kind'];
        const own = pathOf(n.ref) ?? n.label;
        if (isRepoConfigFile(own)) {
            // LICENSE, Dockerfile, dotfiles, root docs: ONE station, not one per file.
            id = 'folder:repo-config'; name = repoConfigName; kind = 'folder';
        } else if (n.area) {
            id = n.area; name = index.get(n.area)?.label ?? tail(n.area); kind = 'area';
        } else {
            const path = pathOf(n.ref) ?? n.label;
            const slash = path.indexOf('/');
            const top = slash > 0 ? path.slice(0, slash) : '';
            id = `folder:${top}`; name = top || '(root)'; kind = 'folder';
        }
        const group = groups.get(id) ?? { id, name, kind, nodes: [] };
        group.nodes.push(n);
        groups.set(id, group);
    }
    return groups;
}

/** Entry files of a mixed group stand as their own station. */
function splitEntry(groups: Map<string, Group>): Group[] {
    const out: Group[] = [];
    for (const g of groups.values()) {
        const entry = g.nodes.filter((n) => n.partition === 'entry');
        if (entry.length === 0 || entry.length === g.nodes.length) { out.push(g); continue; }
        const rest = g.nodes.filter((n) => n.partition !== 'entry');
        const only = entry.length === 1 ? entry[0] : undefined;
        out.push({ ...g, nodes: rest });
        out.push({ id: `${g.id}#entry`, name: only ? tail(only.ref) : g.name, kind: g.kind, nodes: entry });
    }
    return distinctEntryNames(out);
}

/** Two entry stations that would read the same (two `index.ts` in different areas) are named group › file. */
function distinctEntryNames(groups: Group[]): Group[] {
    const taken = new Map<string, number>();
    for (const g of groups) taken.set(g.name, (taken.get(g.name) ?? 0) + 1);
    const parent = new Map(groups.filter((g) => !g.id.endsWith('#entry')).map((g) => [g.id, g.name] as const));
    return groups.map((g) => {
        if (!g.id.endsWith('#entry') || (taken.get(g.name) ?? 0) < 2) return g;
        const group = parent.get(g.id.slice(0, -'#entry'.length));
        return group && group !== g.name ? { ...g, name: `${group} › ${g.name}` } : g;
    });
}

function dominant(values: Array<string | undefined>, rank: (v: string) => number): string | undefined {
    const counts = new Map<string, number>();
    for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || cmp(a[0], b[0]))[0]?.[0];
}

/** Mid-rank quantile level 1–5 of each value among `values`. */
export function quantileLevels(values: ReadonlyMap<string, number>): Map<string, number> {
    const all = [...values.values()].sort((a, b) => a - b);
    // Count of values below `v` (first index not below it) and of values up to `v`, by binary search.
    const bound = (v: number, inclusive: boolean): number => {
        let lo = 0, hi = all.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (all[mid]! < v || (inclusive && all[mid]! === v)) lo = mid + 1; else hi = mid;
        }
        return lo;
    };
    const out = new Map<string, number>();
    for (const [id, v] of values) {
        const less = bound(v, false), equal = bound(v, true) - less;
        const frac = (less + equal / 2) / all.length;
        out.set(id, Math.min(5, Math.max(1, Math.floor(frac * 5) + 1)));
    }
    return out;
}

export function buildStations(graph: KnowledgeGraph, opts: StationOptions = {}): StationModel {
    const index = nodeIndex(graph);
    // A truncated graph's stations come from its outline (every file of the full graph), badges limited to the outline's keys.
    const files = fileNodesOf(graph);
    // Past MAX_STATIONS, areas fold into their parent directory so the map stays readable.
    const groups = splitEntry(rollUpAreas(baseGroups(files, index, opts.repoConfigName ?? REPO_CONFIG_NAME),(id) => index.get(id)?.label ?? tail(id)));
    const groupIds = new Set(groups.map((g) => g.id));
    const stationOf = new Map<string, string>();
    for (const g of groups) for (const n of g.nodes) stationOf.set(n.ref, g.id);
    const lookup = (ref: string) => stationOf.get(ref) ?? stationOf.get(fileRefOf(ref));

    // Refs that are not files still belong somewhere: an area is its own station; a claim or fact stands where the file it is about does.
    const elsewhere = new Map<string, string>();
    for (const n of graph.nodes) if (n.kind === 'area' && groupIds.has(n.ref)) elsewhere.set(n.ref, n.ref);
    for (const e of graph.edges) {
        if (e.kind !== 'about' && e.kind !== 'mentions') continue;
        for (const [judged, source] of [[e.from, e.to], [e.to, e.from]] as const) {
            const station = lookup(source);
            if (station && !lookup(judged) && !elsewhere.has(judged)) elsewhere.set(judged, station);
        }
    }
    const lookupAny = (ref: string) => lookup(ref) ?? elsewhere.get(ref);

    // Findings → the stations they touch, weighted by severity. A system-wide finding (it touches more than a
    // quarter of the stations) counts on none of them: it is listed once, at the top of the Act rail.
    const score = new Map<string, number>(), found = new Map<string, string[]>(), systemWide = new Set<string>();
    const touched = new Set<string>(); // one Set reused for every finding (20,000 of them), cleared each time
    for (const f of graph.findings) {
        touched.clear();
        for (const ref of f.nodes) { const s = lookupAny(ref); if (s) touched.add(s); }
        if (groups.length >= SYSTEM_WIDE_MIN_STATIONS && touched.size / groups.length > SYSTEM_WIDE_SHARE) { systemWide.add(f.id); continue; }
        for (const s of touched) {
            score.set(s, (score.get(s) ?? 0) + SEVERITY_WEIGHT[f.severity]);
            (found.get(s) ?? found.set(s, []).get(s)!).push(f.id);
        }
    }

    // Judged knowledge about files.
    const facts = new Map<string, Set<string>>(), claims = new Map<string, Set<string>>();
    for (const e of graph.edges) {
        if (e.kind !== 'about' && e.kind !== 'mentions') continue;
        for (const [judged, source] of [[e.from, e.to], [e.to, e.from]] as const) {
            const node = index.get(judged);
            const station = lookup(source);
            if (!node || node.origin === 'extracted' || !station) continue;
            const into = node.kind === 'claim' ? claims : facts;
            (into.get(station) ?? into.set(station, new Set()).get(station)!).add(judged);
        }
    }

    const changedSet = opts.changed ?? new Set<string>();
    // Changed = differs from the baseline or the history (the passed set) or carries a live badge; "stale" is a different state.
    const nodeChanged = (n: KNode) =>
        changedSet.has(n.ref)
        || n.badges?.added !== undefined || n.badges?.removed !== undefined || n.badges?.changed !== undefined;

    const anyChurn = files.some((n) => num(n.badges?.churn) !== undefined);
    // No file carries a coverage badge: fall back to the static reach of the test files (a heuristic, said so on the station).
    const reach = hasMeasuredCoverage(dataCoverage(graph)) ? null : staticReach(graph);
    const copies = copyMap(systemsOf(graph));
    const shorts = stationNames(groups.map((g) => g.name));
    const shortNames = new Map(groups.map((g, i) => [g.id, shorts[i]!] as const));
    const raw = groups.map((g) => {
        const complexities = g.nodes.map((n) => num(n.badges?.complexity)).filter((v): v is number => v !== undefined);
        const covs = g.nodes.map((n) => num(n.badges?.coverage)).filter((v): v is number => v !== undefined);
        // ONE basis for every station: the sum of its own files' importance (an entry split never double-counts its area).
        const importance = g.nodes.reduce((a, n) => a + n.importance, 0);
        return {
            g, importance,
            cxRaw: complexities.length ? Math.max(...complexities) : undefined,
            cov: covs.length ? covs.reduce((a, b) => a + b, 0) / covs.length : reachOf(reach, g.nodes.map((n) => n.ref)),
            churnRaw: anyChurn ? g.nodes.reduce((a, n) => a + (num(n.badges?.churn) ?? 0), 0) : undefined,
        };
    });
    const maxUse = Math.max(0, ...raw.map((r) => r.importance));
    const maxChurn = Math.max(0, ...raw.map((r) => r.churnRaw ?? 0));
    const cxLevels = quantileLevels(new Map(raw.filter((r) => r.cxRaw !== undefined).map((r) => [r.g.id, r.cxRaw!] as const)));

    const stations: Station[] = raw.map((r) => {
        const { g } = r;
        const patterns = new Set<string>();
        for (const n of g.nodes) for (const p of String(n.badges?.patterns ?? '').split(',')) if (p.trim()) patterns.add(p.trim());
        const cloneGroups = new Set<string>();
        let unused = 0;
        for (const n of g.nodes) {
            if (n.badges?.cloneGroup !== undefined) cloneGroups.add(String(n.badges.cloneGroup));
            if (n.badges?.unused !== undefined) unused += 1;
            unused += num(n.badges?.unusedExports) ?? 0;
        }
        const station: Station = {
            id: g.id, name: shortNames.get(g.id) ?? g.name, path: g.name, kind: g.kind,
            entry: g.nodes.some((n) => n.partition === 'entry'),
            // Most important first: Show focuses the first 200 and selects the first.
            refs: [...g.nodes].sort((a, b) => b.importance - a.importance || cmp(a.ref, b.ref)).map((n) => n.ref), files: g.nodes.length,
            anti: antiLevel(score.get(g.id) ?? 0), findingIds: found.get(g.id) ?? [],
            use: maxUse > 0 ? r.importance / maxUse : 0,
            changed: g.nodes.some(nodeChanged),
            patterns: [...patterns].sort(cmp), dup: cloneGroups.size, unused,
            facts: facts.get(g.id)?.size ?? 0, claims: claims.get(g.id)?.size ?? 0,
        };
        const layer = dominant(g.nodes.map((n) => n.partition), (v) => layerRank(v) ?? LAYER_ORDER.length);
        if (layer) station.layer = layer;
        const owner = dominant(g.nodes.map((n) => (n.badges?.owner === undefined ? undefined : String(n.badges.owner))), () => 0);
        if (owner) station.owner = owner;
        const own = dominant(g.nodes.map((n) => systemOfNode(n) || undefined), () => 0);
        if (own) {
            station.system = foldedSystem(copies, own);
            if (copies.has(own)) station.copy = own;
            const app = dominant(g.nodes.map((n) => appOfNode(n) || undefined), () => 0);
            if (app) station.app = app;
        }
        const cx = cxLevels.get(g.id);
        if (cx !== undefined) station.cx = cx;
        if (r.cov !== undefined) { station.cov = r.cov; station.covProvenance = reach ? 'heuristic' : 'runtime'; }
        if (r.churnRaw !== undefined) station.churn = maxChurn > 0 ? r.churnRaw / maxChurn : 0;
        return station;
    }).sort((a, b) => b.use - a.use || cmp(a.name, b.name) || cmp(a.id, b.id));

    for (const [ref, station] of elsewhere) stationOf.set(ref, station);
    const view = outlineView(graph);
    return {
        stations, byId: new Map(stations.map((s) => [s.id, s] as const)), stationOf, systemWide,
        ...(view?.capped ? { capped: { shown: view.shown, total: view.total } } : {}),
    };
}

/** File refs whose source differs from the baseline's (or that the baseline lacks). */
export function changedRefs(current: Pick<KnowledgeGraph, 'nodes'>, baseline: Pick<KnowledgeGraph, 'nodes'> | null | undefined): Set<string> {
    const out = new Set<string>();
    if (!baseline) return out;
    const before = new Map(baseline.nodes.filter((n) => n.kind === 'file').map((n) => [n.ref, n.sourceHash] as const));
    for (const n of current.nodes) {
        if (n.kind !== 'file') continue;
        if (!before.has(n.ref) || before.get(n.ref) !== n.sourceHash) out.add(n.ref);
    }
    return out;
}
