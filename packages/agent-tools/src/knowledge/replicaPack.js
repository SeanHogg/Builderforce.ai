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
 *   scope        the root's scope record (last; its review digest only when no file is held back)
 *   analysis     the pending snapshot
 *
 * A pack NEVER asserts a root digest (`targetDigest` is always ZERO_DIGEST): the server may hold leaves of other hosts
 * sharing the root, and a deletion only ever comes from a tombstone the dirty set named.
 *
 * Bodies come through `KnowledgeStore.getExtracted`, never from a snapshot file. A pack that would carry more than
 * `maxFiles` files, or whose DECODED size or row count would pass what the server inflates, is cut: only part of
 * the file keys go, the rest stay dirty (only the LAST slice carries the rows and the scope).
 */
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { bucketOf, diffEntries, encodePack, jsonBytesOf, parseRelationLeafKey, rootLeaves, ZERO_DIGEST, fileLeafKey, } from '@seanhogg/builderforce-memory/knowledge/pack';
import { isCleanKey, isCleanText } from './packKeyGuard.js';
import { factKey, relationKey } from './replicaQueue.js';
import { sourcePathIn } from './rootId.js';
const shown = (s) => JSON.stringify(s.length > 80 ? `${s.slice(0, 80)}…` : s);
const skip = (what, id) => `${what} ${shown(id)} was not synced: its path, key or text holds a control character, NUL or lone surrogate the server refuses`;
/** Largest number of files a within-file diff is attempted for (each needs the server's prior hash). */
export const DIFF_MAX_FILES = 200;
/** Hashes per have request: the server answers any number with ONE index query, so a 20,000-file root asks once. */
const HAVE_CHUNK = 20_000;
const LEAF_BUCKETS_PER_REQUEST = 512;
/** A pack is cut below what the server decodes (24 MB, 200,000 rows: sized for a 128 MB Worker), with headroom for the rows `rowsIn` does not count. */
export const DEFAULT_MAX_DECODED = 16 * 1024 * 1024;
export const DEFAULT_MAX_ROWS = 150_000;
const pairKey = (p) => `${p.hash}\u0000${p.sourceRef}`;
const newMemo = () => ({ have: new Map(), leaves: new Map(), moved: false, bodies: new Map(), fullSize: new Map(), diffs: new Map() });
function bodyOf(memo, local, hash) {
    let body = memo.bodies.get(hash);
    if (!body) {
        body = Promise.resolve(local.getExtracted?.(hash));
        memo.bodies.set(hash, body);
    }
    return body;
}
/** The `(hash, sourceRef)` pairs the project holds among `pairs`, keyed by {@link pairKey}: only pairs not answered yet are asked. */
async function haveAll(memo, client, rootId, pairs) {
    const unknown = [...new Map(pairs.filter((p) => !memo.have.has(pairKey(p))).map((p) => [pairKey(p), p])).values()];
    for (let i = 0; i < unknown.length; i += HAVE_CHUNK) {
        const chunk = unknown.slice(i, i + HAVE_CHUNK);
        (await client.syncHave(rootId, chunk)).forEach((yes, k) => { memo.have.set(pairKey(chunk[k]), yes); });
    }
    return new Set(pairs.map(pairKey).filter((k) => memo.have.get(k) === true));
}
/** The server's leaves in the buckets of `keys`: their digests (the acknowledged hash of a file, its prior) by key. Only buckets not asked yet are asked. */
async function serverLeaves(memo, client, rootId, keys, generation) {
    const buckets = [...new Set(keys.map(bucketOf))];
    const unasked = buckets.filter((b) => !memo.leaves.has(b));
    for (let i = 0; i < unasked.length && !memo.moved; i += LEAF_BUCKETS_PER_REQUEST) {
        const slice = unasked.slice(i, i + LEAF_BUCKETS_PER_REQUEST);
        const answer = await client.syncLeaves(rootId, slice);
        // The server moved since this pack's generation: what it holds is not what this pack applies to.
        if (generation !== 0 && answer.generation !== generation) {
            memo.moved = true;
            break;
        }
        for (const b of slice)
            memo.leaves.set(b, []);
        for (const l of answer.leaves)
            memo.leaves.get(bucketOf(l.key))?.push(l);
    }
    if (memo.moved)
        return undefined;
    const out = new Map();
    for (const b of buckets)
        for (const l of memo.leaves.get(b) ?? [])
            out.set(l.key, l.digest);
    return out;
}
const EMPTY_PACK = { rootId: '', baseGeneration: 0, targetDigest: ZERO_DIGEST };
const EMPTY_EXTRACTED_BYTES = jsonBytesOf({ ...EMPTY_PACK, extracted: [] });
function fullSizeOf(memo, hash, entries) {
    let size = memo.fullSize.get(hash);
    if (!size) {
        size = { chars: JSON.stringify(entries).length, bytes: jsonBytesOf({ ...EMPTY_PACK, extracted: [{ kind: 'full', hash, entries }] }) - EMPTY_EXTRACTED_BYTES };
        memo.fullSize.set(hash, size);
    }
    return size;
}
/** The within-file diff of `hash` against `prior` (memoised per pair), or null when this store holds no body for the prior. */
async function diffOf(memo, local, prior, hash, entries) {
    const key = `${prior}>${hash}`;
    if (!memo.diffs.has(key)) {
        const priorEntries = await bodyOf(memo, local, prior);
        const diffs = priorEntries ? diffEntries(priorEntries, entries) : undefined;
        memo.diffs.set(key, diffs ? { entries: diffs, chars: JSON.stringify(diffs).length } : null);
    }
    return memo.diffs.get(key) ?? null;
}
/** {@link jsonBytesOf} of `pack` with `full` as its bodies, from each body's memoised size: no body is stringified twice. */
function jsonBytesWith(memo, pack, full) {
    const base = jsonBytesOf({ ...pack, extracted: [] });
    if (full.length === 0)
        return base;
    let bytes = base + full.length - 1; // the commas between the bodies
    for (const x of full)
        bytes += x.kind === 'full' ? fullSizeOf(memo, x.hash, x.entries).bytes : 0;
    return bytes;
}
const rowsIn = (pack) => (pack.files?.length ?? 0) + (pack.facts?.length ?? 0) + (pack.relations?.length ?? 0)
    + (pack.extracted ?? []).reduce((n, x) => n + 1 + (x.kind === 'full' ? x.entries.reduce((m, e) => m + 1 + e.nodes.length + e.edges.length + e.keys.length, 0) : x.entries.length), 0);
async function prepare(args, memo) {
    const { rootId, local, client } = args;
    // Rows the server would refuse (a control character in a path or key) never enter the pack or its digest.
    const refusedFiles = [];
    const sources = args.sources.filter((s) => {
        const path = sourcePathIn(s.ref, rootId);
        if (isCleanKey(path))
            return true;
        refusedFiles.push({ key: fileLeafKey(path, s.hash), reason: skip('file', path) });
        return false;
    });
    const byKey = new Map();
    for (const s of sources) {
        const path = sourcePathIn(s.ref, rootId);
        byKey.set(fileLeafKey(path, s.hash), { path, hash: s.hash, bytes: s.bytes ?? 0 });
    }
    // No single file may block a root. Holds are decided over ALL the touched files BEFORE any slicing, so a cut pack can never pull in
    // an unchecked file: a body this store has none of (a locked or unreadable file, a text file not extracted yet) that the project
    // does not hold for the pair (ONE have for those pairs) holds ITS file back. It stays dirty; everything else goes.
    const allFileKeys = args.touched.filter((k) => k.startsWith('f:'));
    const holdKeys = new Set();
    const holdHashes = new Set();
    const pending = [];
    for (const key of allFileKeys) {
        const src = byKey.get(key);
        if (src && (await bodyOf(memo, local, src.hash)) === undefined)
            pending.push({ key, hash: src.hash, sourceRef: srcRef(rootId, src.path) });
    }
    const heldPairs = pending.length > 0 ? await haveAll(memo, client, rootId, pending) : new Set();
    for (const p of pending) {
        if (!args.forceBodies?.has(p.hash) && heldPairs.has(pairKey(p)))
            continue; // the project holds the pair: nothing to send, nothing to wait for
        holdKeys.add(p.key);
        holdHashes.add(p.hash);
    }
    return { sources, byKey, refusedFiles, fileKeys: allFileKeys.filter((k) => !holdKeys.has(k)), holdKeys, holdHashes };
}
async function buildOnce(args, prep, memo, limit) {
    const { rootId, local, client } = args;
    const { sources, byKey, fileKeys, holdKeys, holdHashes } = prep;
    const refused = [...prep.refusedFiles];
    const rowKeys = args.touched.filter((k) => !k.startsWith('f:'));
    const cut = limit !== undefined && fileKeys.length > limit;
    const sentFileKeys = cut ? fileKeys.slice(0, limit) : fileKeys;
    // A pack that is not cut carries the rows, scope, analysis and side rows, held files or not. It never asserts a root digest:
    // the server may hold leaves of other hosts sharing the root, which this pack neither carries nor deletes.
    const final = !cut;
    const complete = final && holdKeys.size === 0;
    // The local state, as the tree sees it: which keys are leaves, which rows exist.
    let allFacts = [], allRels = [];
    let treeKeys = new Set();
    if (final) {
        const [facts, rels] = await (memo.rows ??= Promise.all([local.facts({ rootId }), local.relations({ rootId })]));
        allFacts = facts.filter((f) => {
            if (isCleanKey(f.key) && isCleanText(f.content) && f.fileAnchors.every((a) => isCleanKey(a.path ?? '')))
                return true;
            refused.push({ key: factKey(f.key), reason: skip('fact', f.key) });
            return false;
        });
        allRels = rels.filter((r) => {
            if ([r.from, r.to, r.kind].every(isCleanKey))
                return true;
            refused.push({ key: relationKey(r), reason: skip('relation', `${r.from} -> ${r.to}`) });
            return false;
        });
        const current = sources.map((s) => ({ path: sourcePathIn(s.ref, rootId), hash: s.hash }));
        treeKeys = new Set(rootLeaves(rootId, { files: current, facts: allFacts, relations: allRels }).map((l) => l.key));
    }
    // A row left out because the server would refuse it is skipped and reported, NEVER a tombstone: it still exists locally
    // (only its content or key went bad), so the server's copy of it must stay.
    const refusedKeys = new Set(refused.map((r) => r.key));
    const files = [];
    const gone = []; // touched keys with no leaf now: tombstone candidates
    for (const k of sentFileKeys) {
        const src = byKey.get(k);
        if (src)
            files.push({ path: src.path, hash: src.hash, bytes: src.bytes });
        else if (!refusedKeys.has(k))
            gone.push(k);
    }
    for (const k of rowKeys)
        if (final && !treeKeys.has(k) && !refusedKeys.has(k))
            gone.push(k);
    // ONE leaves lookup answers both questions: which candidates this root owns on the server, and (for few files)
    // the hash the server holds for each changed file, which is the prior a diff is taken against.
    const wantPriors = !args.noDiff && files.length > 0 && files.length <= DIFF_MAX_FILES;
    const ownedKnown = args.ownedKeys;
    const ask = [...(ownedKnown ? [] : gone), ...(wantPriors ? files.map((f) => fileLeafKey(f.path, f.hash)) : [])];
    const leafMap = ask.length > 0 ? await serverLeaves(memo, client, rootId, ask, args.baseGeneration) : new Map();
    const owned = (k) => (ownedKnown ? ownedKnown.has(k) : leafMap?.has(k) === true);
    const priorOf = new Map();
    if (wantPriors && leafMap) {
        for (const f of files) {
            const p = leafMap.get(fileLeafKey(f.path, f.hash));
            if (p && p !== f.hash)
                priorOf.set(f.hash, p);
        }
    }
    // ONE have for the bodies and the priors, per (hash, THIS root's sourceRef): a hash the project holds only under another
    // root still uploads this root's entry. A body goes in only for a hash with a file the project lacks, as a diff when the
    // prior is held for that file.
    const hashes = [...new Set(files.map((f) => f.hash))];
    const asked = new Map();
    for (const f of files) {
        const sourceRef = srcRef(rootId, f.path);
        for (const hash of [f.hash, priorOf.get(f.hash)])
            if (hash)
                asked.set(pairKey({ hash, sourceRef }), { hash, sourceRef });
    }
    // Pairs the holds already asked (or an earlier cut of this pack) are answered from the memo: only new pairs are asked.
    const held = await haveAll(memo, client, rootId, [...asked.values()]);
    const heldFor = (hash, f) => held.has(pairKey({ hash, sourceRef: srcRef(rootId, f.path) }));
    const need = hashes.filter((h) => files.some((f) => f.hash === h && !heldFor(h, f)) || args.forceBodies?.has(h));
    const extracted = [];
    const fullExtr = [];
    for (const hash of need) {
        const entries = await bodyOf(memo, local, hash);
        // (An absent body never gets here: its files were held back above.) An explicit `[]` is the review's record that
        // nothing is extracted for this file (binary): it goes as an explicit empty body, so the server stops asking for it.
        if (!entries)
            continue; // defensive: every needed body was checked above, so an absent one has its files held back
        if (entries.length === 0) {
            const none = { kind: 'full', hash, entries: [] };
            fullExtr.push(none);
            extracted.push(none);
            continue;
        }
        fullExtr.push({ kind: 'full', hash, entries });
        const prior = priorOf.get(hash);
        const diff = prior && files.some((f) => f.hash === hash && heldFor(prior, f)) ? await diffOf(memo, local, prior, hash, entries) : null;
        extracted.push(diff && diff.chars * 5 < fullSizeOf(memo, hash, entries).chars * 4
            ? { kind: 'diff', hash, prior: prior, entries: diff.entries }
            : { kind: 'full', hash, entries });
    }
    const pack = { rootId, baseGeneration: args.baseGeneration, targetDigest: ZERO_DIGEST };
    if (files.length > 0)
        pack.files = files;
    if (extracted.length > 0)
        pack.extracted = extracted;
    const tombstones = { files: [], facts: [], relations: [] };
    const side = { facts: [], relations: [], keys: [] };
    for (const k of gone) {
        if (!owned(k)) {
            // Not this root's on the server. A row that exists locally still goes, through its own writer.
            continue;
        }
        if (k.startsWith('f:'))
            tombstones.files.push(k.slice(2));
        else if (k.startsWith('a:'))
            tombstones.facts.push(k.slice(2));
        else if (k.startsWith('r:')) {
            const r = parseRelationLeafKey(k);
            if (r)
                tombstones.relations.push(r);
        }
    }
    if (final) {
        const facts = new Map(allFacts.map((f) => [factKey(f.key), f]));
        const rels = new Map(allRels.map((r) => [relationKey(r), r]));
        for (const k of rowKeys) {
            if (treeKeys.has(k)) {
                if (k.startsWith('a:'))
                    (pack.facts ??= []).push(facts.get(k));
                else
                    (pack.relations ??= []).push(rels.get(k));
            }
            else if (!owned(k)) {
                const f = facts.get(k), r = rels.get(k);
                if (f) {
                    side.facts.push(f);
                    side.keys.push(k);
                }
                else if (r) {
                    side.relations.push(r);
                    side.keys.push(k);
                }
            }
        }
        const scope = (await local.scopes()).find((s) => s.rootId === rootId);
        // While a file is held back the review digest is not the server's state: the scope goes without it (the immutable review snapshot is keyed by it),
        // and without what that review was measured with (PRD 41 §C9: `measured` describes the review AT the digest, recorded when it ran — the
        // pack carries that record as is, never this host's versions now).
        if (scope) {
            const { lastDigest: _held, measured: _heldMeasured, ...rest } = scope;
            pack.scope = complete ? scope : rest;
        }
        if (args.analysis)
            pack.analysis = { sha: args.analysis.sha, snapshot: args.analysis.snapshot };
    }
    if (tombstones.files.length + tombstones.facts.length + tombstones.relations.length > 0)
        pack.deletes = tombstones;
    const stats = { decodedBytes: 0 };
    const bytes = await encodePack(pack, { stats });
    const oversize = stats.decodedBytes > (args.maxDecodedBytes ?? DEFAULT_MAX_DECODED) || rowsIn(pack) > (args.maxRows ?? DEFAULT_MAX_ROWS);
    const sentKeys = final ? args.touched.filter((k) => !holdKeys.has(k)) : sentFileKeys;
    const settled = new Set(sentKeys);
    return {
        bytes, oversize, decodedBytes: stats.decodedBytes,
        jsonBytes: jsonBytesWith(memo, pack, fullExtr),
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
export async function buildPack(args) {
    // Every cut reuses what the first attempt asked and read (have, leaves, bodies, rows, body sizes): a retry re-slices only.
    const memo = newMemo();
    const prep = await prepare(args, memo);
    let limit = args.maxFiles;
    for (let attempt = 0; attempt < 16; attempt++) {
        const built = await buildOnce(args, prep, memo, limit);
        if (!built.oversize || built.files <= 1)
            return built;
        limit = Math.max(1, Math.floor(built.files / 2));
    }
    return buildOnce(args, prep, memo, limit);
}
//# sourceMappingURL=replicaPack.js.map