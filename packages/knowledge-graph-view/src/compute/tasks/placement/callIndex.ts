/**
 * The symbol-level edges a Sequence reads (PRD 43 B1a rule 10, memory P0b), resolved once per request: the graph's own
 * (`KEdge`, `sites` on a `calls` edge) and the host's loaded records' (`SymbolRecord.relations`). A target is resolved to
 * a node ref (exact, or `<file ref>#<name>` without `@line`); a call to no node is an EXTERNAL, keyed {@link externalKey}
 * so the sequence draws it as a terminus participant. Pure.
 */

import type { CallSite, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { SymbolRecord } from '../../../types';

export interface Call { to: string; site: CallSite | null }
export interface Association { from: string; to: string; kind: AssociationKind }

/** The class-band association stubs (rule 10): why one class can reach another. */
export const ASSOCIATION_KINDS = ['extends', 'implements', 'composes'] as const;
export type AssociationKind = typeof ASSOCIATION_KINDS[number];
const isAssociation = (k: string): k is AssociationKind => (ASSOCIATION_KINDS as readonly string[]).includes(k);

/** The participant key of a call target the graph does not hold (a package, an unresolved import). */
export const EXTERNAL_PREFIX = 'ext:';
export const externalKey = (raw: string): string => `${EXTERNAL_PREFIX}${raw}`;
export const isExternal = (key: string): boolean => key.startsWith(EXTERNAL_PREFIX);
/** An external's name: what follows `#` (the called name), else the last path part. */
export const externalName = (key: string): string => {
    const raw = key.slice(EXTERNAL_PREFIX.length);
    const hash = raw.lastIndexOf('#');
    return hash >= 0 ? raw.slice(hash + 1) : raw.slice(raw.lastIndexOf('/') + 1);
};

export interface CallIndex {
    /** Per caller, its calls in call-site order (`order`, then line, column, target). */
    calls: Map<string, Call[]>;
    associations: Association[];
    /** Every external target key, sorted: the same list whatever the band, so their appended slots stay put. */
    externals: string[];
}

const siteOrder = (c: Call): number => c.site?.order ?? Number.POSITIVE_INFINITY;

export function callIndex(full: KnowledgeGraph, records: readonly SymbolRecord[]): CallIndex {
    const refs = new Set(full.nodes.map((n) => n.ref as string));
    const noLine = new Map<string, string>();
    for (const r of refs) { const bare = r.replace(/@\d+$/, ''); if (!noLine.has(bare)) noLine.set(bare, r); }
    const resolve = (to: string): string | undefined => (refs.has(to) ? to : noLine.get(to));
    const calls = new Map<string, Call[]>();
    const associations: Association[] = [];
    const externals = new Set<string>();
    const seen = new Set<string>();
    const add = (from: string, kind: string, rawTo: string, sites: readonly CallSite[] | undefined) => {
        const resolved = resolve(rawTo);
        if (isAssociation(kind)) {
            const key = `${from}\0${kind}\0${resolved}`;
            if (resolved && !seen.has(key)) { seen.add(key); associations.push({ from, to: resolved, kind }); }
            return;
        }
        if (kind !== 'calls') return;
        const to = resolved ?? externalKey(rawTo);
        if (!resolved) externals.add(to);
        for (const site of sites?.length ? sites : [null]) {
            const key = `${from}\0${to}\0${site ? `${site.order}:${site.line}:${site.column}` : ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            let list = calls.get(from);
            if (!list) calls.set(from, (list = []));
            list.push({ to, site });
        }
    };
    for (const e of full.edges) add(e.from, e.kind, e.to, e.sites);
    for (const r of records) for (const rel of r.relations ?? []) add(r.ref, rel.kind, rel.to, rel.sites);
    for (const list of calls.values()) list.sort((a, b) => siteOrder(a) - siteOrder(b) || (a.site?.line ?? 0) - (b.site?.line ?? 0) || (a.site?.column ?? 0) - (b.site?.column ?? 0) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    return { calls, associations, externals: [...externals].sort() };
}
