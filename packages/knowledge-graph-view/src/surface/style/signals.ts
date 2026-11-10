/**
 * The readings the Architecture Style model scores — PURE: ONE pass over the source files and ONE over their
 * `references` edges. Every reading is a count out of a total plus a few example file refs (sorted), so a check
 * shows the evidence it was scored on. No model call, no clock, no randomness: equal graphs read equal.
 * Only the source files count (`sourceFilesOf`: no tests, no stray copies).
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { cmp } from '../../order';
import { parseRoutes } from '../drawers/apiModel';
import { LAYER_ORDER, layerRank } from '../layers';
import { mapEdges } from '../outlineGraph';
import { sourceFilesOf } from '../sourceFiles';
import { appOfNode, systemOfNode } from '../systems';

/** Example refs kept per reading. */
export const EXAMPLES = 3;

/** `count` of `total`, and up to {@link EXAMPLES} of the files that were counted. */
export interface Reading { count: number; total: number; refs: string[] }

export interface StyleSignals {
    /** Source files read. */
    files: number;
    /** Files in the domain layer, of all files. */
    domain: Reading;
    /** Of the five layers, how many hold a file. */
    layers: Reading;
    /** Files named as DDD building blocks (aggregate, entity, value object, repository, domain event). */
    dddNamed: Reading;
    /** Dependencies from the domain to another layer, of the domain's dependencies on layered files. */
    domainOutward: Reading;
    /** Dependencies from infrastructure to the domain or application, of infrastructure's dependencies on layered files. */
    inverted: Reading;
    /** Dependencies to a higher layer, of every dependency between layered files. */
    upward: Reading;
    /** Dependencies that jump over a layer, of every dependency between layered files. */
    skips: Reading;
    /** Files under a client / server folder, and files that register routes. */
    client: Reading;
    server: Reading;
    routes: Reading;
    /** Deployable units (systems, else apps): count = units; units with an entry point; units holding only presentation or only infrastructure. */
    units: Reading;
    unitsWithEntry: Reading;
    tierSplit: Reading;
    /** Dependencies between two units, of the dependencies whose both ends sit in a unit. */
    crossUnit: Reading;
}

const DDD_WORDS = ['aggregate', 'entity', 'entities', 'valueobject', 'repository', 'domainevent'];
const CLIENT_DIRS = new Set(['client', 'clients', 'frontend', 'web', 'webapp', 'ui', 'mobile']);
const SERVER_DIRS = new Set(['server', 'servers', 'backend', 'api']);

interface Tally { count: number; total: number; refs: Set<string> }
const tally = (): Tally => ({ count: 0, total: 0, refs: new Set() });
const hit = (t: Tally, ref: string): void => { t.count++; t.refs.add(ref); };
const done = (t: Tally): Reading => ({ count: t.count, total: t.total, refs: [...t.refs].sort(cmp).slice(0, EXAMPLES) });

const stemOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z]/g, '');
const dirsOf = (path: string): string[] => path.toLowerCase().split('/').slice(0, -1);

/** True when some source file sits in one of the five layers: the camera has something to classify. */
export const hasLayeredCode = (graph: KnowledgeGraph): boolean => sourceFilesOf(graph).some((n) => layerRank(n.partition) !== undefined);

/** The deployable unit of each file: its system when the root holds several, else its app ('' = none). */
function unitReader(files: readonly KNode[]): (n: KNode) => string {
    const systems = new Set(files.map(systemOfNode).filter(Boolean));
    return systems.size >= 2 ? systemOfNode : appOfNode;
}

export function readStyleSignals(graph: KnowledgeGraph): StyleSignals {
    const files = sourceFilesOf(graph);
    const byRef = new Map(files.map((n) => [n.ref, n] as const));
    const unitOf = unitReader(files);
    const domain = tally(), dddNamed = tally(), client = tally(), server = tally(), routes = tally();
    const units = new Map<string, { entry: boolean; presentation: string | null; infrastructure: string | null }>();
    const layersUsed = new Set<string>();
    for (const n of files) {
        const path = pathOf(n.ref) ?? n.label;
        for (const t of [domain, dddNamed, client, server, routes]) t.total++;
        if (n.partition === 'domain') hit(domain, n.ref);
        if (layerRank(n.partition) !== undefined) layersUsed.add(n.partition!);
        const stem = stemOf(path);
        if (DDD_WORDS.some((w) => stem.includes(w))) hit(dddNamed, n.ref);
        const dirs = dirsOf(path);
        if (dirs.some((d) => CLIENT_DIRS.has(d))) hit(client, n.ref);
        if (dirs.some((d) => SERVER_DIRS.has(d))) hit(server, n.ref);
        if (parseRoutes(n.badges?.routes).length > 0) hit(routes, n.ref);
        const unit = unitOf(n);
        if (!unit) continue;
        const row = units.get(unit) ?? units.set(unit, { entry: false, presentation: null, infrastructure: null }).get(unit)!;
        if (n.partition === 'entry') row.entry = true;
        if (n.partition === 'presentation' && (row.presentation === null || cmp(n.ref, row.presentation) < 0)) row.presentation = n.ref;
        if (n.partition === 'infrastructure' && (row.infrastructure === null || cmp(n.ref, row.infrastructure) < 0)) row.infrastructure = n.ref;
    }

    const domainOutward = tally(), inverted = tally(), upward = tally(), skips = tally(), crossUnit = tally();
    for (const e of mapEdges(graph)) {
        if (e.kind !== 'references' || e.from === e.to) continue;
        const a = byRef.get(e.from), b = byRef.get(e.to);
        if (!a || !b) continue;
        const ua = unitOf(a), ub = unitOf(b);
        if (ua && ub) { crossUnit.total++; if (ua !== ub) hit(crossUnit, a.ref); }
        const from = layerRank(a.partition), to = layerRank(b.partition);
        if (from === undefined || to === undefined) continue;
        upward.total++; skips.total++;
        if (from > to) hit(upward, a.ref);
        if (to - from > 1) hit(skips, a.ref);
        if (a.partition === 'domain') { domainOutward.total++; if (b.partition !== 'domain') hit(domainOutward, a.ref); }
        if (a.partition === 'infrastructure') { inverted.total++; if (b.partition === 'domain' || b.partition === 'application') hit(inverted, a.ref); }
    }

    const unitRows = [...units].sort(([x], [y]) => cmp(x, y));
    const unitsRead = tally(), withEntry = tally(), tierSplit = tally();
    for (const [, row] of unitRows) {
        unitsRead.count++; unitsRead.total++; withEntry.total++; tierSplit.total++;
        const example = row.presentation ?? row.infrastructure;
        if (row.entry) { withEntry.count++; if (example) withEntry.refs.add(example); }
        const only = (row.presentation === null) !== (row.infrastructure === null);
        if (only) hit(tierSplit, example!);
    }
    const layers: Reading = { count: layersUsed.size, total: LAYER_ORDER.length, refs: [] };
    return {
        files: files.length, domain: done(domain), layers, dddNamed: done(dddNamed),
        domainOutward: done(domainOutward), inverted: done(inverted), upward: done(upward), skips: done(skips),
        client: done(client), server: done(server), routes: done(routes),
        units: done(unitsRead), unitsWithEntry: done(withEntry), tierSplit: done(tierSplit), crossUnit: done(crossUnit),
    };
}
