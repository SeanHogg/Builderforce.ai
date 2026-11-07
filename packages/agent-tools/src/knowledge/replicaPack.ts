/**
 * knowledge/replicaPack.ts — builds the ONE pack a sync sends (PRD 41 A11), from the LOCAL store.
 *
 * Input is a set of touched keys (the dirty set on the fast path, the manifest tree's differing keys on
 * the reconcile path): for each, the current body is read from the local store, or — when the row no
 * longer exists — a tombstone is written. Nothing is sent "just in case":
 *
 *   files        `(path, hash)` of the touched sources; their EXTR body goes in only when the project does not
 *                already hold that hash (`syncHave`), and as a DIFF against the acknowledged prior extraction
 *                of the same path when the server holds that prior (few files only)
 *   facts, rels  the touched rows; tombstones for touched keys with no row
 *   scope        the root's scope record (last, with the digest the server must reach)
 *   analysis     the pending snapshot
 *
 * Bodies come through `KnowledgeStore.getExtracted`, never from a snapshot file. A pack that would carry
 * more than `maxFiles` files is cut: only that many file keys go, the rest stay dirty, and the pack
 * asserts no digest (only the LAST slice carries the rows, the scope and the `targetDigest`).
 */

import type { Extracted, KnowledgeStore, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import {
    bucketOf, diffEntries, encodePack, jsonBytesOf, rootDigestOf, ZERO_DIGEST, fileLeafKey,
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
}

/** Largest number of files a within-file diff is attempted for (each needs the server's prior hash). */
export const DIFF_MAX_FILES = 200;
/** Hashes per have request: the server answers any number with ONE index query, so a 20,000-file root asks once. */
const HAVE_CHUNK = 20_000;
const CHUNK_PARALLEL = 4;

export const pathOfRef = (rootId: string, ref: string): string => {
    const prefix = `src:${rootId}::`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
    const at = ref.indexOf('::');
    return at >= 0 ? ref.slice(at + 2) : ref;
};

async function haveAll(client: PackQueries, rootId: string, hashes: readonly string[]): Promise<Set<string>> {
    const held = new Set<string>();
    const chunks: string[][] = [];
    for (let i = 0; i < hashes.length; i += HAVE_CHUNK) chunks.push(hashes.slice(i, i + HAVE_CHUNK));
    for (let i = 0; i < chunks.length; i += CHUNK_PARALLEL) {
        await Promise.all(chunks.slice(i, i + CHUNK_PARALLEL).map(async (chunk) => {
            (await client.syncHave(rootId, chunk)).forEach((yes, k) => { if (yes) held.add(chunk[k]!); });
        }));
    }
    return held;
}

const parseRelationKey = (key: string): { from: string; to: string; kind: string } => {
    const [from = '', to = '', kind = ''] = key.slice(2).split('\u0000');
    return { from, to, kind };
};

export async function buildPack(args: BuildArgs): Promise<BuiltPack> {
    const { rootId, local, client } = args;
    const byKey = new Map<string, { path: string; hash: string; bytes: number }>();
    for (const s of args.sources) { const path = pathOfRef(rootId, s.ref); byKey.set(fileLeafKey(path, s.hash), { path, hash: s.hash, bytes: s.bytes ?? 0 }); }

    const fileKeys = args.touched.filter((k) => k.startsWith('f:'));
    const rowKeys = args.touched.filter((k) => !k.startsWith('f:'));
    const cut = args.maxFiles !== undefined && fileKeys.length > args.maxFiles;
    const sentFileKeys = cut ? fileKeys.slice(0, args.maxFiles) : fileKeys;
    const final = !cut;

    const files: Array<{ path: string; hash: string; bytes: number }> = [];
    const deleteFiles: string[] = [];
    for (const k of sentFileKeys) {
        const src = byKey.get(k);
        if (src) files.push({ path: src.path, hash: src.hash, bytes: src.bytes });
        else deleteFiles.push(k.slice(2)); // a source id: the path, or `~tag|path` for a root-level output
    }

    // Bodies: only for hashes the project lacks, as a diff when the acknowledged prior is known.
    const hashes = [...new Set(files.map((f) => f.hash))];
    const held = await haveAll(client, rootId, hashes);
    const need = hashes.filter((h) => !held.has(h) || args.forceBodies?.has(h));
    const priorOf = new Map<string, string>();
    if (!args.noDiff && files.length > 0 && files.length <= DIFF_MAX_FILES && need.length > 0) {
        const buckets = [...new Set(files.map((f) => bucketOf(fileLeafKey(f.path, f.hash))))];
        const server = await client.syncLeaves(rootId, buckets);
        if (server.generation === args.baseGeneration || args.baseGeneration === 0) {
            const priors = new Map(server.leaves.map((l) => [l.key, l.digest] as const));
            for (const f of files) { const p = priors.get(fileLeafKey(f.path, f.hash)); if (p && p !== f.hash) priorOf.set(f.hash, p); }
        }
    }
    const priorHeld = priorOf.size > 0 ? await haveAll(client, rootId, [...new Set(priorOf.values())]) : new Set<string>();

    const extracted: PackExtr[] = [];
    const fullExtr: PackExtr[] = [];
    for (const hash of need) {
        const entries: Extracted[] | undefined = await local.getExtracted?.(hash);
        if (!entries || entries.length === 0) continue;
        fullExtr.push({ kind: 'full', hash, entries });
        const prior = priorOf.get(hash);
        const priorEntries = prior && priorHeld.has(prior) ? await local.getExtracted?.(prior) : undefined;
        const diffs = priorEntries ? diffEntries(priorEntries, entries) : undefined;
        extracted.push(diffs && JSON.stringify(diffs).length * 5 < JSON.stringify(entries).length * 4
            ? { kind: 'diff', hash, prior: prior!, entries: diffs }
            : { kind: 'full', hash, entries });
    }

    const pack: Pack = { rootId, baseGeneration: args.baseGeneration, targetDigest: ZERO_DIGEST };
    if (files.length > 0) pack.files = files;
    if (extracted.length > 0) pack.extracted = extracted;
    const tombstones = { files: deleteFiles, facts: [] as string[], relations: [] as Array<{ from: string; to: string; kind: string }> };

    let allFacts: StoredFact[] = [], allRels: StoredRelation[] = [];
    if (final) {
        [allFacts, allRels] = await Promise.all([local.facts({ rootId }), local.relations({ rootId })]);
        const facts = new Map(allFacts.map((f) => [factKey(f.key), f]));
        const rels = new Map(allRels.map((r) => [relationKey(r), r]));
        for (const k of rowKeys) {
            if (k.startsWith('a:')) { const f = facts.get(k); if (f) (pack.facts ??= []).push(f); else tombstones.facts.push(k.slice(2)); }
            else if (k.startsWith('r:')) { const r = rels.get(k); if (r) (pack.relations ??= []).push(r); else tombstones.relations.push(parseRelationKey(k)); }
        }
        const scope = (await local.scopes()).find((s) => s.rootId === rootId);
        if (scope) pack.scope = scope;
        if (args.analysis) pack.analysis = { sha: args.analysis.sha, snapshot: args.analysis.snapshot };
        const current = args.sources.map((s) => ({ path: pathOfRef(rootId, s.ref), hash: s.hash }));
        pack.targetDigest = rootDigestOf(rootId, { files: current, facts: allFacts, relations: allRels });
    }
    if (tombstones.files.length + tombstones.facts.length + tombstones.relations.length > 0) pack.deletes = tombstones;

    return {
        bytes: await encodePack(pack),
        jsonBytes: jsonBytesOf({ ...pack, extracted: fullExtr }),
        files: files.length,
        sentKeys: final ? [...args.touched] : sentFileKeys,
        final,
        analysisSent: final && !!args.analysis,
    };
}
