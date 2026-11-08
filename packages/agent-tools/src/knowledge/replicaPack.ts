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

import { srcRef, type Extracted, type KnowledgeStore, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import {
    bucketOf, diffEntries, encodePack, jsonBytesOf, parseRelationLeafKey, rootLeaves, rootDigestOf, ZERO_DIGEST, fileLeafKey,
    type Pack, type PackExtr,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import { isCleanKey, isCleanText } from './packKeyGuard.js';
import { factKey, relationKey, type ReplicaAnalysis } from './replicaQueue.js';

/** A row the pack left out because the server would refuse its key (`422 bad_pack`), with the dirty key it settles. */
export interface SkippedRow { key: string; reason: string }

const shown = (s: string): string => JSON.stringify(s.length > 80 ? `${s.slice(0, 80)}…` : s);
const skip = (what: string, id: string): string => `${what} ${shown(id)} was not synced: its path, key or text holds a control character, NUL or lone surrogate the server refuses`;

/** A current source: its ref, content hash, and size in bytes when the host's stat cache knows it. */
export interface ReplicaSource { ref: string; hash: string; bytes?: number | undefined }

/** The knowledge client's sync calls the pack builder uses. */
export interface PackQueries {
    /** Which `(hash, sourceRef)` pairs the project holds a body entry for (same order as asked). */
    syncHave(rootId: string, pairs: ReadonlyArray<{ hash: string; sourceRef: string }>): Promise<boolean[]>;
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
    /** ADDITIVE root: the server holds leaves this store lacks, so the pack never asserts the root digest (it would be the local tree's alone). */
    additive?: boolean;
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
    /** The pack was not cut: it carried every touched key but the held-back files (and so the rows, scope and analysis; the digest only when nothing is held). */
    final: boolean;
    analysisSent: boolean;
    /** Rows left out because their path or key holds a control character; their keys are in `sentKeys` (settled, never retried). */
    skipped: SkippedRow[];
    /** Rows that are not the pack's to carry, with their dirty keys: sent through `writeRows` after the pack. */
    sideRows: { facts: StoredFact[]; relations: StoredRelation[]; keys: string[] };
    decodedBytes: number;
    /** Files left OUT of the pack because this store holds no body for their hash and the project holds none for the pair: they stay dirty. */
    waiting: number;
    /** The content hashes of those files (for the re-check channel). */
    waitingHashes: string[];
}

/** Largest number of files a within-file diff is attempted for (each needs the server's prior hash). */
export const DIFF_MAX_FILES = 200;
/** Hashes per have request: the server answers any number with ONE index query, so a 20,000-file root asks once. */
const HAVE_CHUNK = 20_000;
const LEAF_BUCKETS_PER_REQUEST = 512;
/** A pack is cut below what the server decodes (24 MB, 200,000 rows: sized for a 128 MB Worker), with headroom for the rows `rowsIn` does not count. */
export const DEFAULT_MAX_DECODED = 16 * 1024 * 1024;
export const DEFAULT_MAX_ROWS = 150_000;

export const pathOfRef = (rootId: string, ref: string): string => {
    const prefix = `src:${rootId}::`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
    const at = ref.indexOf('::');
    return at >= 0 ? ref.slice(at + 2) : ref;
};

const pairKey = (p: { hash: string; sourceRef: string }): string => `${p.hash}\u0000${p.sourceRef}`;

/** The `(hash, sourceRef)` pairs the project holds among `pairs`, keyed by {@link pairKey}. */
async function haveAll(client: PackQueries, rootId: string, pairs: readonly { hash: string; sourceRef: string }[]): Promise<Set<string>> {
    const held = new Set<string>();
    for (let i = 0; i < pairs.length; i += HAVE_CHUNK) {
        const chunk = pairs.slice(i, i + HAVE_CHUNK);
        (await client.syncHave(rootId, chunk)).forEach((yes, k) => { if (yes) held.add(pairKey(chunk[k]!)); });
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

const rowsIn = (pack: Pack): number =>
    (pack.files?.length ?? 0) + (pack.facts?.length ?? 0) + (pack.relations?.length ?? 0)
    + (pack.extracted ?? []).reduce((n, x) => n + 1 + (x.kind === 'full' ? x.entries.reduce((m, e) => m + 1 + e.nodes.length + e.edges.length + e.keys.length, 0) : x.entries.length), 0);


async function buildOnce(args: BuildArgs, limit: number | undefined): Promise<BuiltPack & { oversize: boolean }> {
    const { rootId, local, client } = args;
    // Rows the server would refuse (a control character in a path or key) never enter the pack or its digest.
    const refused: SkippedRow[] = [];
    const sources = args.sources.filter((s) => {
        const path = pathOfRef(rootId, s.ref);
        if (isCleanKey(path)) return true;
        refused.push({ key: fileLeafKey(path, s.hash), reason: skip('file', path) });
        return false;
    });
    const byKey = new Map<string, { path: string; hash: string; bytes: number }>();
    for (const s of sources) { const path = pathOfRef(rootId, s.ref); byKey.set(fileLeafKey(path, s.hash), { path, hash: s.hash, bytes: s.bytes ?? 0 }); }

    // No single file may block a root. Holds are decided over ALL the touched files BEFORE any slicing, so a cut pack can never pull in
    // an unchecked file: a body this store has none of (a locked or unreadable file, a text file not extracted yet) that the project
    // does not hold for the pair (ONE have for those pairs) holds ITS file back. It stays dirty; everything else goes.
    const allFileKeys = args.touched.filter((k) => k.startsWith('f:'));
    const holdKeys = new Set<string>();
    const holdHashes = new Set<string>();
    // Pairs already asked of the project (and the held ones among them): the body batch below does not ask them again.
    const answered = new Set<string>();
    const heldAnswers = new Set<string>();
    {
        const absentHash = new Map<string, boolean>();
        const pending: Array<{ key: string; hash: string; sourceRef: string }> = [];
        for (const key of allFileKeys) {
            const src = byKey.get(key);
            if (!src) continue;
            if (!absentHash.has(src.hash)) absentHash.set(src.hash, (await local.getExtracted?.(src.hash)) === undefined);
            if (absentHash.get(src.hash)) pending.push({ key, hash: src.hash, sourceRef: srcRef(rootId, src.path) });
        }
        const heldPairs = pending.length > 0 ? await haveAll(client, rootId, pending) : new Set<string>();
        for (const p of pending) answered.add(pairKey(p));
        for (const k of heldPairs) heldAnswers.add(k);
        for (const p of pending) {
            if (!args.forceBodies?.has(p.hash) && heldPairs.has(pairKey(p))) continue; // the project holds the pair: nothing to send, nothing to wait for
            holdKeys.add(p.key);
            holdHashes.add(p.hash);
        }
    }

    const fileKeys = allFileKeys.filter((k) => !holdKeys.has(k));
    const rowKeys = args.touched.filter((k) => !k.startsWith('f:'));
    const cut = limit !== undefined && fileKeys.length > limit;
    const sentFileKeys = cut ? fileKeys.slice(0, limit) : fileKeys;
    // A pack that is not cut carries the rows, scope, analysis and side rows, held files or not. It asserts the root digest only when nothing is held back.
    const final = !cut;
    const complete = final && holdKeys.size === 0;
    const asserts = complete && !args.additive;
    // The local state, as the tree sees it: which keys are leaves, which rows exist.
    let allFacts: StoredFact[] = [], allRels: StoredRelation[] = [];
    let treeKeys = new Set<string>();
    if (final) {
        const [facts, rels] = await Promise.all([local.facts({ rootId }), local.relations({ rootId })]);
        allFacts = facts.filter((f) => {
            if (isCleanKey(f.key) && isCleanText(f.content) && f.fileAnchors.every((a) => isCleanKey(a.path ?? ''))) return true;
            refused.push({ key: factKey(f.key), reason: skip('fact', f.key) });
            return false;
        });
        allRels = rels.filter((r) => {
            if ([r.from, r.to, r.kind].every(isCleanKey)) return true;
            refused.push({ key: relationKey(r), reason: skip('relation', `${r.from} -> ${r.to}`) });
            return false;
        });
        const current = sources.map((s) => ({ path: pathOfRef(rootId, s.ref), hash: s.hash }));
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

    // ONE have for the bodies and the priors, per (hash, THIS root's sourceRef): a hash the project holds only under another
    // root still uploads this root's entry. A body goes in only for a hash with a file the project lacks, as a diff when the
    // prior is held for that file.
    const hashes = [...new Set(files.map((f) => f.hash))];
    const asked = new Map<string, { hash: string; sourceRef: string }>();
    for (const f of files) {
        const sourceRef = srcRef(rootId, f.path);
        for (const hash of [f.hash, priorOf.get(f.hash)]) if (hash) asked.set(pairKey({ hash, sourceRef }), { hash, sourceRef });
    }
    const held = new Set([...heldAnswers, ...(await haveAll(client, rootId, [...asked.values()].filter((p) => !answered.has(pairKey(p)))))]);
    const heldFor = (hash: string, f: { path: string }): boolean => held.has(pairKey({ hash, sourceRef: srcRef(rootId, f.path) }));
    const need = hashes.filter((h) => files.some((f) => f.hash === h && !heldFor(h, f)) || args.forceBodies?.has(h));

    const extracted: PackExtr[] = [];
    const fullExtr: PackExtr[] = [];
    for (const hash of need) {
        const entries: Extracted[] | undefined = await local.getExtracted?.(hash);
        // (An absent body never gets here: its files were held back above.) An explicit `[]` is the review's record that
        // nothing is extracted for this file (binary): it goes as an explicit empty body, so the server stops asking for it.
        if (!entries) continue; // defensive: every needed body was checked above, so an absent one has its files held back
        if (entries.length === 0) {
            const none: PackExtr = { kind: 'full', hash, entries: [] };
            fullExtr.push(none);
            extracted.push(none);
            continue;
        }
        fullExtr.push({ kind: 'full', hash, entries });
        const prior = priorOf.get(hash);
        const priorEntries = prior && files.some((f) => f.hash === hash && heldFor(prior, f)) ? await local.getExtracted?.(prior) : undefined;
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
        else if (k.startsWith('r:')) { const r = parseRelationLeafKey(k); if (r) tombstones.relations.push(r); }
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
        // While a file is held back the review digest is not the server's state: the scope goes without it (the immutable review snapshot is keyed by it).
        // An ADDITIVE root still records its review (baseline, snapshot): only the pack's `targetDigest` is not asserted.
        if (scope) { const { lastDigest: _held, ...rest } = scope; pack.scope = complete ? scope : rest; }
        if (args.analysis) pack.analysis = { sha: args.analysis.sha, snapshot: args.analysis.snapshot };
        const current = sources.map((s) => ({ path: pathOfRef(rootId, s.ref), hash: s.hash }));
        if (asserts) pack.targetDigest = rootDigestOf(rootId, { files: current, facts: allFacts, relations: allRels });
    }
    if (tombstones.files.length + tombstones.facts.length + tombstones.relations.length > 0) pack.deletes = tombstones;

    const stats = { decodedBytes: 0 };
    const bytes = await encodePack(pack, { stats });
    const oversize = stats.decodedBytes > (args.maxDecodedBytes ?? DEFAULT_MAX_DECODED) || rowsIn(pack) > (args.maxRows ?? DEFAULT_MAX_ROWS);
    const sentKeys = final ? args.touched.filter((k) => !holdKeys.has(k)) : sentFileKeys;
    const settled = new Set(sentKeys);
    return {
        bytes, oversize, decodedBytes: stats.decodedBytes,
        jsonBytes: jsonBytesOf({ ...pack, extracted: fullExtr }),
        files: files.length,
        // Only a row this pack was asked to settle is reported: a skipped row outside the slice is reported by the slice that carries it.
        skipped: refused.filter((r) => settled.has(r.key)),
        sentKeys,
        final,
        analysisSent: final && !!args.analysis,
        sideRows: side,
        waiting: holdKeys.size,
        waitingHashes: [...holdHashes],
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
