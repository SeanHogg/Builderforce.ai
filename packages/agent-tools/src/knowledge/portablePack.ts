/**
 * knowledge/portablePack.ts — the portable knowledge pack (`.bfpack`): a reviewed folder's
 * knowledge graph plus its retrieval cards as one self-contained, LLM-agnostic JSON file.
 *
 * The snapshot is memory's canonical `KnowledgeSnapshot` (facts = judged model knowledge;
 * the extracted cache lets a consumer rebuild perception without re-reading sources), and
 * the cards are memory's `IndexDoc` retrieval layer, so any consumer — VS Code, Synapse,
 * Canvas — queries the pack and injects top cards as context with nothing installed.
 *
 * Pure: no vscode, no fs — data in, data out. Serialization is canonical (object keys
 * sorted, every list sorted on a stable key, `undefined` dropped), so equal content is
 * equal bytes, and merging is deterministic in both input orders.
 */

import {
    canonicalJson,
    compareStr,
    type IndexDoc,
    type KnowledgeSnapshot,
    type StoredFact,
    type StoredRelation,
} from '@seanhogg/builderforce-memory/knowledge';

/** One portable knowledge pack — the payload of a `.bfpack` file. */
export interface PortableKnowledgePack {
    version: 1;
    /** Human name, e.g. the folder basename. */
    name: string;
    /** ISO timestamp of the pack's creation (or last update). */
    createdAt: string;
    rootId: string;
    title: string;
    /** Scopes + facts + relations + extracted cache. */
    snapshot: KnowledgeSnapshot;
    /** Retrieval cards (the LLM-agnostic layer); absent = the consumer rebuilds them. */
    cards?: IndexDoc[];
}

export interface PackFromSnapshotArgs {
    name: string;
    rootId: string;
    title: string;
    snapshot: KnowledgeSnapshot;
    cards?: IndexDoc[];
    /** ISO clock. Default `new Date().toISOString()`. */
    now?(): string;
}

/** A relation's unique key — matches `relKey` in memory's localSnapshotStore exactly. */
const relKey = (r: Pick<StoredRelation, 'from' | 'to' | 'kind'>) => `${r.from}\\u0000${r.to}\\u0000${r.kind}`;

export function packFromSnapshot(args: PackFromSnapshotArgs): PortableKnowledgePack {
    const now = args.now ?? (() => new Date().toISOString());
    return {
        version: 1,
        name: args.name,
        createdAt: now(),
        rootId: args.rootId,
        title: args.title,
        snapshot: args.snapshot,
        cards: args.cards,
    };
}

/** Canonically ordered pack: scopes by rootId, facts by key, relations by triple, cards by id. */
function canonicalize(pack: PortableKnowledgePack): PortableKnowledgePack {
    const s = pack.snapshot;
    const sortRecord = <T>(rec: Record<string, T[]>, by: (a: T, b: T) => number): Record<string, T[]> =>
        Object.fromEntries(
            Object.keys(rec).sort(compareStr).map((k) => [k, [...rec[k]!].sort(by)]),
        );
    return {
        version: 1,
        name: pack.name,
        createdAt: pack.createdAt,
        rootId: pack.rootId,
        title: pack.title,
        snapshot: {
            version: 1,
            scopes: [...s.scopes].sort((a, b) => compareStr(a.rootId, b.rootId)),
            facts: sortRecord(s.facts, (a, b) => compareStr(a.key, b.key)),
            relations: sortRecord(s.relations, (a, b) => compareStr(relKey(a), relKey(b))),
            extracted: sortRecord(s.extracted, (a, b) => compareStr(a.sourceRef, b.sourceRef)),
        },
        cards: pack.cards && [...pack.cards].sort((a, b) => compareStr(a.id, b.id)),
    };
}

/** Canonical JSON: equal content is equal bytes. */
export function serializePack(pack: PortableKnowledgePack): string {
    return canonicalJson(canonicalize(pack));
}

function fail(message: string): never {
    throw new Error(`knowledge pack: ${message}`);
}

function recordOf(value: unknown, field: string): Record<string, unknown[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`snapshot.${field} must be a record`);
    return value as Record<string, unknown[]>;
}

/** Parses and validates a `.bfpack`, throwing a descriptive error on any malformed field. */
export function parsePack(text: string): PortableKnowledgePack {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (err) {
        fail(`not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const pack = raw as Partial<PortableKnowledgePack>;
    if (pack.version !== 1) fail(`unsupported version ${JSON.stringify(pack.version)} (expected 1)`);
    for (const field of ['name', 'createdAt', 'rootId', 'title'] as const) {
        if (typeof pack[field] !== 'string' || pack[field] === '') fail(`missing required string field "${field}"`);
    }
    const snapshot = pack.snapshot as Partial<KnowledgeSnapshot> | undefined;
    if (!snapshot || typeof snapshot !== 'object') fail('missing required snapshot');
    if (!Array.isArray(snapshot.scopes)) fail('snapshot.scopes must be an array');
    const facts = recordOf(snapshot.facts, 'facts');
    const relations = recordOf(snapshot.relations, 'relations');
    const extracted = recordOf(snapshot.extracted, 'extracted');
    for (const [field, rec] of [['facts', facts], ['relations', relations], ['extracted', extracted]] as const) {
        for (const [key, list] of Object.entries(rec)) {
            if (!Array.isArray(list)) fail(`snapshot.${field}[${JSON.stringify(key)}] must be an array`);
        }
    }
    if (pack.cards !== undefined && !Array.isArray(pack.cards)) fail('cards must be an array when present');
    return canonicalize(pack as PortableKnowledgePack);
}

/**
 * The UPDATE operation: a pack re-reviewed into `fresh` folded onto `base`. The result keeps
 * `base`'s identity (name, rootId) and takes `fresh`'s title; scopes merge by rootId, facts
 * by key, relations by the `from\to\kind` triple, extracted by content hash — `fresh` wins
 * every conflict. `createdAt` becomes now(). Deterministic: equal inputs (in either merge
 * order of the underlying lists) serialize to identical bytes.
 */
export function mergePacks(
    base: PortableKnowledgePack,
    fresh: PortableKnowledgePack,
    opts: { now?(): string } = {},
): PortableKnowledgePack {
    const now = opts.now ?? (() => new Date().toISOString());

    const scopes = new Map<string, KnowledgeSnapshot['scopes'][number]>();
    for (const scope of [...base.snapshot.scopes, ...fresh.snapshot.scopes]) scopes.set(scope.rootId, scope);

    const facts = new Map<string, Map<string, StoredFact>>();
    for (const snapshot of [base.snapshot, fresh.snapshot]) {
        for (const [rootId, list] of Object.entries(snapshot.facts)) {
            const merged = facts.get(rootId) ?? new Map<string, StoredFact>();
            for (const fact of list) merged.set(fact.key, fact);
            facts.set(rootId, merged);
        }
    }

    const relations = new Map<string, Map<string, StoredRelation>>();
    for (const snapshot of [base.snapshot, fresh.snapshot]) {
        for (const [rootId, list] of Object.entries(snapshot.relations)) {
            const merged = relations.get(rootId) ?? new Map<string, StoredRelation>();
            for (const relation of list) merged.set(relKey(relation), relation);
            relations.set(rootId, merged);
        }
    }

    const extracted: Record<string, KnowledgeSnapshot['extracted'][string]> = { ...base.snapshot.extracted };
    for (const [hash, list] of Object.entries(fresh.snapshot.extracted)) extracted[hash] = list;

    return canonicalize({
        version: 1,
        name: base.name,
        createdAt: now(),
        rootId: base.rootId,
        title: fresh.title || base.title,
        snapshot: {
            version: 1,
            scopes: [...scopes.values()],
            facts: Object.fromEntries([...facts.entries()].map(([k, m]) => [k, [...m.values()]])),
            relations: Object.fromEntries([...relations.entries()].map(([k, m]) => [k, [...m.values()]])),
            extracted,
        },
        cards: fresh.cards ?? base.cards,
    });
}
