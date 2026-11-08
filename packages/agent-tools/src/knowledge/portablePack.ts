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

import { ROOT_OUTPUT_HASH_PREFIX } from './codeNodes.js';
import { moveRoot } from './fileManifest.js';
import {
    canonicalJson,
    compareStr,
    factRef,
    pathOfRef,
    type IndexDoc,
    type KnowledgeSnapshot,
    type StoredFact,
    type StoredRelation,
} from '@seanhogg/builderforce-memory/knowledge';

/**
 * The snapshot a pack carries: memory's `KnowledgeSnapshot` with the extract cache EXPLICIT. A store keeps its cache beside the snapshot
 * now (memory's `extractedLog`), so the snapshot type makes `extracted` optional; a pack file still embeds its extracted map (the format is
 * unchanged), and a pack is built from `store.extractedEntries()`, never from a snapshot's own key.
 */
/** `recheck` is a host-local channel between a replica and the review, never part of a portable pack. */
export type PackSnapshot = Required<Omit<KnowledgeSnapshot, 'recheck'>>;

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
    snapshot: PackSnapshot;
    /** Retrieval cards (the LLM-agnostic layer); absent = the consumer rebuilds them. */
    cards?: IndexDoc[];
    /** Who reviewed the pack's knowledge and with what; absent on packs that recorded none. */
    provenance?: PackProvenance;
}

/** Where a pack's judged knowledge came from (all optional; informational, never trusted for access). */
export interface PackProvenance {
    /** The signed-in person who ran the review (display name or email). */
    reviewedBy?: string;
    /** The model the review's judgement used; absent when no judgement ran. */
    judgeModel?: string;
    /** The review policy / judgement mode, when the runner has one. */
    policy?: string;
    /** ISO time of the review. */
    reviewedAt?: string;
}

export interface PackFromSnapshotArgs {
    name: string;
    rootId: string;
    title: string;
    snapshot: PackSnapshot;
    cards?: IndexDoc[];
    provenance?: PackProvenance;
    /** ISO clock. Default `new Date().toISOString()`. */
    now?(): string;
}

/** A relation's unique key — matches `relKey` in memory's localSnapshotStore exactly. */
const relKey = (r: Pick<StoredRelation, 'from' | 'to' | 'kind'>) => `${r.from}\u0000${r.to}\u0000${r.kind}`;

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
        ...(args.provenance ? { provenance: args.provenance } : {}),
    };
}

/** Canonically ordered pack: scopes by rootId, facts by key, relations by triple, cards by id. */
function canonicalize(pack: PortableKnowledgePack): PortableKnowledgePack {
    const s = pack.snapshot;
    // Repeats collapse (the last one wins), so equal content is equal bytes however often a record was listed.
    const uniqueBy = <T>(list: readonly T[], keyOf: (t: T) => string): T[] => [...new Map(list.map((t) => [keyOf(t), t] as const)).values()];
    const sortRecord = <T>(rec: Record<string, T[]>, by: (a: T, b: T) => number, keyOf?: (t: T) => string): Record<string, T[]> =>
        Object.fromEntries(
            Object.keys(rec).sort(compareStr).map((k) => [k, (keyOf ? uniqueBy(rec[k]!, keyOf) : [...rec[k]!]).sort(by)]),
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
            facts: sortRecord(s.facts, (a, b) => compareStr(a.key, b.key), (f) => f.key),
            relations: sortRecord(s.relations, (a, b) => compareStr(relKey(a), relKey(b)), relKey),
            extracted: sortRecord(s.extracted, (a, b) => compareStr(a.sourceRef, b.sourceRef)),
        },
        cards: pack.cards && [...pack.cards].sort((a, b) => compareStr(a.id, b.id)),
        provenance: canonicalProvenance(pack.provenance),
    };
}

/** The four known provenance fields that hold a string; nothing left ⇒ no provenance, so a pack without it keeps its bytes. */
function canonicalProvenance(p: PackProvenance | undefined): PackProvenance | undefined {
    if (!p) return undefined;
    const out: PackProvenance = {};
    for (const field of ['reviewedBy', 'judgeModel', 'policy', 'reviewedAt'] as const) {
        if (typeof p[field] === 'string') out[field] = p[field];
    }
    return Object.keys(out).length > 0 ? out : undefined;
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
    const snapshot = pack.snapshot as Partial<PackSnapshot> | undefined;
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
    if (pack.provenance !== undefined) {
        const p = pack.provenance as unknown;
        if (!p || typeof p !== 'object' || Array.isArray(p)) fail('provenance must be an object when present');
        for (const [field, value] of Object.entries(p)) {
            if (value !== undefined && typeof value !== 'string') fail(`provenance.${field} must be a string when present`);
        }
    }
    return canonicalize(pack as PortableKnowledgePack);
}

/**
 * The pack re-keyed onto `rootId`: its root id, scope root ids, the per-root keys of
 * facts/relations and every source ref of the old root inside facts, relations, extracted
 * records and cards (a structured walk — `moveRoot`, which leaves prose fields alone). A
 * moved folder's fresh review is rebased onto the pack's root before it is merged, so its
 * new facts are kept. A no-op (the same object) when the root ids are equal.
 *
 * Claim fact keys (`claim:` + a hash of the section ref and the subject/predicate/object) are
 * NOT recomputed: the triple is not stored, only its words. `mergePacks` therefore folds a
 * rebased claim onto its stale twin by content and anchors instead.
 */
export function rebasePackRoot(pack: PortableKnowledgePack, rootId: string): PortableKnowledgePack {
    if (pack.rootId === rootId) return pack;
    const moved = moveRoot(pack, pack.rootId, rootId) as PortableKnowledgePack;
    // Provenance says who reviewed and with what, never where: it is not re-keyed.
    return pack.provenance ? { ...moved, provenance: pack.provenance } : moved;
}

/** The reviewed files `base` holds that `freshHashOf` (the fresh review's extracted refs) no longer lists. */
function deletedPaths(base: PortableKnowledgePack, freshRefs: ReadonlyMap<string, string>): Set<string> {
    const live = new Set([...freshRefs.keys()].map((ref) => pathOfRef(ref)));
    const gone = new Set<string>();
    for (const list of Object.values(base.snapshot.extracted)) {
        for (const e of list) {
            const path = pathOfRef(e.sourceRef);
            if (path !== undefined && !e.sourceHash.startsWith(ROOT_OUTPUT_HASH_PREFIX) && !live.has(path)) gone.add(path);
        }
    }
    return gone;
}

/** What makes two claim facts the same claim when their keys differ: their words and the files they are anchored to. */
const claimSignature = (f: StoredFact): string =>
    JSON.stringify([f.content, [...new Set((f.fileAnchors ?? []).map((a) => a.path))].sort(compareStr)]);

/**
 * The UPDATE operation: a pack re-reviewed into `fresh` folded onto `base`. The result keeps
 * `base`'s identity (name, rootId) and takes `fresh`'s title; scopes merge by rootId, facts
 * by key, relations by the `from\0to\0kind` triple, extracted by content hash — `fresh` wins
 * every conflict. `createdAt` becomes now(). Deterministic: equal inputs (in either merge
 * order of the underlying lists) serialize to identical bytes.
 *
 * Two refinements keep the pack from accumulating stale knowledge:
 *   - a base claim that `fresh` judged again under a different key (a claim's key hashes its
 *     section ref, which embeds the root id, so a moved folder re-keys every claim and the
 *     triple is not stored to recompute it) is the same claim — same content, same anchors
 *     — and is dropped, its relations moved to the fresh key;
 *   - with `mirror` (Update), the pack mirrors the folder: a file `fresh` no longer lists is
 *     forgotten, with the base facts and relations that were anchored only to it. A `fresh`
 *     with no extracted records at all is no evidence of a deleted folder, so nothing is forgotten.
 */
export function mergePacks(
    base: PortableKnowledgePack,
    fresh: PortableKnowledgePack,
    opts: { now?(): string; mirror?: boolean } = {},
): PortableKnowledgePack {
    const now = opts.now ?? (() => new Date().toISOString());

    const scopes = new Map<string, PackSnapshot['scopes'][number]>();
    for (const scope of [...base.snapshot.scopes, ...fresh.snapshot.scopes]) scopes.set(scope.rootId, scope);

    // Fresh wins per hash; and a file re-extracted at a NEW hash supersedes its older records (the cache is not a history).
    const freshHashOf = new Map<string, string>();
    for (const [hash, list] of Object.entries(fresh.snapshot.extracted)) for (const e of list) freshHashOf.set(e.sourceRef, hash);
    const gone = opts.mirror && freshHashOf.size > 0 ? deletedPaths(base, freshHashOf) : new Set<string>();
    const extracted: Record<string, PackSnapshot['extracted'][string]> = {};
    for (const [hash, list] of Object.entries(base.snapshot.extracted)) {
        const kept = list.filter((e) => (freshHashOf.get(e.sourceRef) ?? hash) === hash && !gone.has(pathOfRef(e.sourceRef) ?? '\u0000'));
        if (kept.length) extracted[hash] = kept;
    }
    for (const [hash, list] of Object.entries(fresh.snapshot.extracted)) extracted[hash] = list;

    const dropped = new Set<string>(); // refs of base facts forgotten with their files
    const freshClaims = new Map<string, string>(); // claim signature → fresh key
    for (const list of Object.values(fresh.snapshot.facts)) for (const f of list) if (f.key.startsWith('claim:')) freshClaims.set(claimSignature(f), f.key);
    const moved = new Map<string, string>(); // `fact:claim:<stale>` → `fact:claim:<fresh>`

    const facts = new Map<string, Map<string, StoredFact>>();
    const mergeFacts = (list: readonly StoredFact[], fromBase: boolean, rootId: string) => {
        const merged = facts.get(rootId) ?? new Map<string, StoredFact>();
        for (const fact of list) {
            if (fromBase) {
                const anchors = fact.fileAnchors ?? [];
                if (gone.size > 0 && anchors.length > 0 && anchors.every((a) => gone.has(a.path))) { dropped.add(factRef(fact.key)); continue; }
                const same = fact.key.startsWith('claim:') ? freshClaims.get(claimSignature(fact)) : undefined;
                if (same !== undefined && same !== fact.key) { moved.set(factRef(fact.key), factRef(same)); continue; }
            }
            merged.set(fact.key, fact);
        }
        facts.set(rootId, merged);
    };
    for (const [rootId, list] of Object.entries(base.snapshot.facts)) mergeFacts(list, true, rootId);
    for (const [rootId, list] of Object.entries(fresh.snapshot.facts)) mergeFacts(list, false, rootId);

    const refGone = (ref: string): boolean => dropped.has(ref) || (gone.size > 0 && gone.has(pathOfRef(ref) ?? '\u0000'));
    const relations = new Map<string, Map<string, StoredRelation>>();
    const mergeRelations = (list: readonly StoredRelation[], fromBase: boolean, rootId: string) => {
        const merged = relations.get(rootId) ?? new Map<string, StoredRelation>();
        for (const relation of list) {
            if (fromBase && (refGone(relation.from) || refGone(relation.to))) continue;
            const r = fromBase
                ? { ...relation, from: (moved.get(relation.from) ?? relation.from) as StoredRelation['from'], to: (moved.get(relation.to) ?? relation.to) as StoredRelation['to'] }
                : relation;
            merged.set(relKey(r), r);
        }
        relations.set(rootId, merged);
    };
    for (const [rootId, list] of Object.entries(base.snapshot.relations)) mergeRelations(list, true, rootId);
    for (const [rootId, list] of Object.entries(fresh.snapshot.relations)) mergeRelations(list, false, rootId);

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
        // The latest review's provenance wins; a fresh review that recorded none keeps the base's.
        provenance: fresh.provenance ?? base.provenance,
    });
}
