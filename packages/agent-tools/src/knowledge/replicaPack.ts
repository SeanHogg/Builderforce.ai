/**
 * knowledge/replicaPack.ts — builds the ONE pack a sync sends (PRD 41 A11), from the LOCAL store.
 *
 * Input is a set of touched keys (the dirty set on the fast path, the manifest tree's differing keys on
 * the reconcile path): for each, the current body is read from the local store. Nothing is sent "just in case":
 *
 *   files        `(path, hash)` of the touched sources; their EXTR body goes in only when the project does not
 *                already hold that hash (ONE `syncHave` for the bodies and the priors), and as a DIFF against the
 *                acknowledged prior extraction of the same path when the server holds that prior (few files only)
 *   facts, rels  the touched MODEL rows that are leaves of the root's tree. Every other row (a person's note, an
 *                agent's fact, a model row with no leaf) is returned as `sideRows` for its own writer.
 *   tombstones   a touched key that is no longer a leaf of the tree, and that the server holds as a leaf of THIS
 *                root (asked of `syncLeaves`, or already known to be, from a reconcile): the server refuses any other
 *   scope        the root's scope record (last, with the digest the server must reach)
 *   analysis     the pending snapshot
 *
 * Bodies come through `KnowledgeStore.getExtracted`, never from a snapshot file. A pack that would carry more than
 * `maxFiles` files, or whose DECODED size or row count would pass what the server inflates, is cut: only part of
 * the file keys go, the rest stay dirty, and the pack asserts no digest (only the LAST slice carries the rows, the
 * scope and the `targetDigest`).
 */

import type { Extracted, KnowledgeStore, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import {
    bucketOf, diffEntries, encodePack, jsonBytesOf, rootLeaves, rootDigestOf, ZERO_DIGEST, fileLeafKey,
    type Pack, type PackExtr,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import { factKey, relationKey, type ReplicaAnalysis } from './replicaQueue.js';

/** A current source: its ref, content hash, and size in bytes when the host's stat cache knows it. */
export interface ReplicaSource { ref: string; hash: string; bytes?: number | undefined }

/** The knowledge client's sync calls the pack builder uses. */
export interface PackQueries {
    syncHave(rootId: string, hashes: readonly string[]): Promise<boolean[]>;
    syncLeaves(rootId: string, bucketIds: readonly number[]): Promise<{ generation: number; leaves: Array<{ key: string; digest: string }> }>;
}

export interface BuildArgs {
    rootId: string;
    local: KnowledgeStore;
    sources: readonly ReplicaSource[];
    client: PackQueries;
    touched: readonly string[];
    baseGeneration: number;
    analysis?: ReplicaAnalysis | undefined;
    /** Cut the pack to this many file keys (a 413 halves it). */
    maxFiles?: number;
    /** Never diff (the server answered `prior_missing`). */
    noDiff?: boolean;
    /** Hashes whose bodies go in whatever `syncHave` says (the server answered `extracted_missing`). */
    forceBodies?: ReadonlySet<string>;
    /** Keys already known to be leaves of the root on the server (a reconcile's removals): no lookup needed. */
    ownedKeys?: ReadonlySet<string>;
    /** The pack is cut before its DECODED body passes this (default 48 MB of the server's 64 MB). */
    maxDecodedBytes?: number;
    /** The pack is cut before it holds more rows than this (default 600,000 of the server's 1,000,000). */
    maxRows?: number;
}

export interface BuiltPack {
    bytes: Uint8Array;
    /** The bytes the same rows would take as JSON (full bodies, no diffs). */
    jsonBytes: number;
    files: number;
    /** The touched keys this pack settles. */
    sentKeys: string[];
    /** The pack carried every touched key (and so the rows, scope, analysis and the digest). */
    final: boolean;
    analysisSent: boolean;
    /** Rows that are not the pack's to carry, with their dirty keys: sent through `writeRows` after the pack. */
    sideRows: { facts: StoredFact[]; relations: StoredRelation[]; keys: string[] };
    decodedBytes: number;
}

/** Largest number of files a within-file diff is attempted for (each needs the server's prior hash). */
export const DIFF_MAX_FILES = 200;
/** Hashes per have request: the server answers any number with ONE index query, so a 20,000-file root asks once. */
const HAVE_CHUNK = 20_000;
const LEAF_BUCKETS_PER_REQUEST = 512;
export const DEFAULT_MAX_DECODED = 48 * 1024 * 1024;
export const DEFAULT_MAX_ROWS = 600_000;

export const pathOfRef = (rootId: string, ref: string): string => {
    const prefix = `src:${rootId}::`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
    const at = ref.indexOf('::');
    return at >= 0 ? ref.slice(at + 2) : ref;
};

async function haveAll(client: PackQueries, rootId: string, hashes: readonly string[]): Promise<Set<string>> {
    const held = new Set<string>();
    for (let i = 0; i < hashes.length; i += HAVE_CHUNK) {
        const chunk = hashes.slice(i, i + HAVE_CHUNK);
        (await client.syncHave(rootId, chunk)).forEach((yes, k) => { if (yes) held.add(chunk[k]!); });
    }
    return held;
}

/** The server's leaves in the buckets of `keys`: their digests (the acknowledged hash of a file, its prior) by key. */
async function serverLeaves(client: PackQueries, rootId: string, keys: readonly string[], generation: number): Promise<Map<string, string> | undefined> {
    const buckets = [...new Set(keys.map(bucketOf))];
    const out = new Map<string, string>();
    for (let i = 0; i < buckets.length; i += LEAF_BUCKETS_PER_REQUEST) {
        const answer = await client.syncLeaves(rootId, buckets.slice(i, i + LEAF_BUCKETS_PER_REQUEST));
        // The server moved since this pack's generation: what it holds is not what this pack applies to.
        if (generation !== 0 && answer.generation !== generation) return undefined;
        for (const l of answer.leaves) out.set(l.key, l.digest);
    }
    return out;
}

const parseRelationKey = (key: string): { from: string; to: string; kind: string } => {
    const [from = '', to = '', kind = ''] = key.slice(2).split('\u0000');
    return { from, to, kind };
};

const rowsIn = (pack: Pack): number =>
    (pack.files?.length ?? 0) + (pack.facts?.length ?? 0) + (pack.relations?.length ?? 0)
    + (pack.extracted ?? []).reduce((n, x) => n + 1 + (x.kind === 'full' ? x.entries.reduce((m, e) => m + 1 + e.nodes.length + e.edges.length + e.keys.length, 0) : x.entries.length), 0);

async function buildOnce(args: BuildArgs, limit: number | undefined): Promise<BuiltPack & { oversize: boolean }> {
    const { rootId, local, client } = args;
    const byKey = new Map<string, { path: string; hash: string; bytes: number }>();
    for (const s of args.sources) { const path = pathOfRef(rootId, s.ref); byKey.set(fileLeafKey(path, s.hash), { path, hash: s.hash, bytes: s.bytes ?? 0 }); }

    const fileKeys = args.touched.filter((k) => k.startsWith('f:'));
    const rowKeys = args.touched.filter((k) => !k.startsWith('f:'));
    const cut = limit !== undefined && fileKeys.length > limit;
    const sentFileKeys = cut ? fileKeys.slice(0, limit) : fileKeys;
    const final = !cut;

    // The local state, as the tree sees it: which keys are leaves, which rows exist.
    let allFacts: StoredFact[] = [], allRels: StoredRelation[] = [];
    let treeKeys = new Set<string>();
    if (final) {
        [allFacts, allRels] = await Promise.all([local.facts({ rootId }), local.relations({ rootId })]);
        const current = args.sources.map((s) => ({ path: pathOfRef(rootId, s.ref), hash: s.hash }));
        treeKeys = new Set(rootLeaves(rootId, { files: current, facts: allFacts, relations: allRels }).map((l) => l.key));
    }

    const files: Array<{ path: string; hash: string; bytes: number }> = [];
    const gone: string[] = []; // touched keys with no leaf now: tombstone candidates
    for (const k of sentFileKeys) {
        const src = byKey.get(k);
        if (src) files.push({ path: src.path, hash: src.hash, bytes: src.bytes });
        else gone.push(k);
    }
    for (const k of rowKeys) if (final && !treeKeys.has(k)) gone.push(k);

    // ONE leaves lookup answers both questions: which candidates this root owns on the server, and (for few files)
    // the hash the server holds for each changed file, which is the prior a diff is taken against.
    const wantPriors = !args.noDiff && files.length > 0 && files.length <= DIFF_MAX_FILES;
    const ownedKnown = args.ownedKeys;
    const ask = [...(ownedKnown ? [] : gone), ...(wantPriors ? files.map((f) => fileLeafKey(f.path, f.hash)) : [])];
    const leafMap = ask.length > 0 ? await serverLeaves(client, rootId, ask, args.baseGeneration) : new Map<string, string>();
    const owned = (k: string): boolean => (ownedKnown ? ownedKnown.has(k) : leafMap?.has(k) === true);

    const priorOf = new Map<string, string>();
    if (wantPriors && leafMap) {
        for (const f of files) { const p = leafMap.get(fileLeafKey(f.path, f.hash)); if (p && p !== f.hash) priorOf.set(f.hash, p); }
    }

    // ONE have for the bodies and the priors: bodies only for hashes the project lacks, as a diff when the prior is held.
    const hashes = [...new Set(files.map((f) => f.hash))];
    const held = await haveAll(client, rootId, [...new Set([...hashes, ...priorOf.values()])]);
    const need = hashes.filter((h) => !held.has(h) || args.forceBodies?.has(h));

    const extracted: PackExtr[] = [];
    const fullExtr: PackExtr[] = [];
    for (const hash of need) {
        const entries: Extracted[] | undefined = await local.getExtracted?.(hash);
        if (!entries || entries.length === 0) continue;
        fullExtr.push({ kind: 'full', hash, entries });
        const prior = priorOf.get(hash);
        const priorEntries = prior && held.has(prior) ? await local.getExtracted?.(prior) : undefined;
        const diffs = priorEntries ? diffEntries(priorEntries, entries) : undefined;
        extracted.push(diffs && JSON.stringify(diffs).length * 5 < JSON.stringify(entries).length * 4
            ? { kind: 'diff', hash, prior: prior!, entries: diffs }
            : { kind: 'full', hash, entries });
    }

    const pack: Pack = { rootId, baseGeneration: args.baseGeneration, targetDigest: ZERO_DIGEST };
    if (files.length > 0) pack.files = files;
    if (extracted.length > 0) pack.extracted = extracted;
    const tombstones = { files: [] as string[], facts: [] as string[], relations: [] as Array<{ from: string; to: string; kind: string }> };
    const side = { facts: [] as StoredFact[], relations: [] as StoredRelation[], keys: [] as string[] };

    for (const k of gone) {
        if (!owned(k)) {
            // Not this root's on the server. A row that exists locally still goes, through its own writer.
            continue;
        }
        if (k.startsWith('f:')) tombstones.files.push(k.slice(2));
        else if (k.startsWith('a:')) tombstones.facts.push(k.slice(2));
        else if (k.startsWith('r:')) tombstones.relations.push(parseRelationKey(k));
    }
    if (final) {
        const facts = new Map(allFacts.map((f) => [factKey(f.key), f]));
        const rels = new Map(allRels.map((r) => [relationKey(r), r]));
        for (const k of rowKeys) {
            if (treeKeys.has(k)) {
                if (k.startsWith('a:')) (pack.facts ??= []).push(facts.get(k)!);
                else (pack.relations ??= []).push(rels.get(k)!);
            } else if (!owned(k)) {
                const f = facts.get(k), r = rels.get(k);
                if (f) { side.facts.push(f); side.keys.push(k); } else if (r) { side.relations.push(r); side.keys.push(k); }
            }
        }
        const scope = (await local.scopes()).find((s) => s.rootId === rootId);
        if (scope) pack.scope = scope;
        if (args.analysis) pack.analysis = { sha: args.analysis.sha, snapshot: args.analysis.snapshot };
        const current = args.sources.map((s) => ({ path: pathOfRef(rootId, s.ref), hash: s.hash }));
        pack.targetDigest = rootDigestOf(rootId, { files: current, facts: allFacts, relations: allRels });
    }
    if (tombstones.files.length + tombstones.facts.length + tombstones.relations.length > 0) pack.deletes = tombstones;

    const stats = { decodedBytes: 0 };
    const bytes = await encodePack(pack, { stats });
    const oversize = stats.decodedBytes > (args.maxDecodedBytes ?? DEFAULT_MAX_DECODED) || rowsIn(pack) > (args.maxRows ?? DEFAULT_MAX_ROWS);
    return {
        bytes, oversize, decodedBytes: stats.decodedBytes,
        jsonBytes: jsonBytesOf({ ...pack, extracted: fullExtr }),
        files: files.length,
        sentKeys: final ? [...args.touched] : sentFileKeys,
        final,
        analysisSent: final && !!args.analysis,
        sideRows: side,
    };
}

/**
 * Builds the pack, cutting it in half by file keys (the rest stay dirty) for as long as its decoded size or row count
 * would pass what the server inflates and it still holds more than one file.
 */
export async function buildPack(args: BuildArgs): Promise<BuiltPack> {
    let limit = args.maxFiles;
    for (let attempt = 0; attempt < 16; attempt++) {
        const built = await buildOnce(args, limit);
        if (!built.oversize || built.files <= 1) return built;
        limit = Math.max(1, Math.floor(built.files / 2));
    }
    return buildOnce(args, limit);
}
