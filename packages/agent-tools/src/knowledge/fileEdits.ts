/**
 * knowledge/fileEdits.ts — an edited source makes what was judged from it stale (PRD 38
 * §5.2, WS5): the moment a reviewed file changes on disk, its model facts and relations are
 * marked stale at the file's NEW content hash, its perception is re-extracted by that hash
 * (memory's ONE `extractFile`, from the NEW content), and the hash the graph is built with
 * moves to it — so `buildGraph` shows the claims stale until the next review judges the new
 * text. No model call, nothing deleted.
 *
 * The review's own manifest is NOT moved: a later review still sees the file as changed and
 * judges it again. The new hash lives beside it (`knowledge:<root>:edited`), with the hash
 * the file had when it was reviewed (its BASE), and {@link currentFileHashes} reads it over
 * the review's only while that base is still the review's: once a review has judged the file
 * again (or dropped it) the entry is spent, so an old edit can never hide a newer review,
 * nor a file deleted and created again.
 *
 * ONE helper for every host that watches a reviewed folder (the editor's live graph, the
 * on-prem agent after a review). Pure over ports. Edits arrive in bursts (a save, a
 * formatter, a branch switch): the watcher settles them for {@link EDIT_DEBOUNCE_MS} and
 * applies the batch with one read of the known entity keys and one write of the manifest.
 */

import {
    composePacks, extractFile, filesManifestKey, isBinaryText, knownKeysOfEntities, sha256Hex, srcRef,
    type DirectorySource, type KnowledgePack, type KnowledgeStore, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { normalizePath, textDocument, type KnowledgeFs } from './fsDirectorySource.js';

/** Manifest entry naming the content hash each edited file has NOW (path → `<hash>|<base>`; hash '' = deleted). */
export const editedManifestKey = (rootId: string): string => `knowledge:${rootId}:edited`;

/** Edits settle this long before they are applied. */
export const EDIT_DEBOUNCE_MS = 400;

/**
 * The entity keys a root's files can `mention`, read from the store once and held: a save
 * must not cost a read of every stored fact. A host drops it when a review finishes
 * ({@link KnownKeysCache.invalidate}) — the only thing that changes the entities.
 */
export interface KnownKeysCache {
    get(): Promise<ReadonlyMap<string, NodeRef>>;
    invalidate(): void;
}

export function knownKeysCache(store: KnowledgeStore, rootId: string): KnownKeysCache {
    let held: Promise<ReadonlyMap<string, NodeRef>> | undefined;
    return {
        get: () => (held ??= store.facts({ rootId }).then((facts) => knownKeysOfEntities(facts.map((f) => f.key))).catch((error: unknown) => {
            held = undefined; // A failed read is retried by the next save.
            throw error;
        })),
        invalidate: () => { held = undefined; },
    };
}

export interface FileEditPorts {
    rootId: string;
    /** Absolute path of the reviewed folder. */
    rootPath: string;
    fs: Pick<KnowledgeFs, 'readFile'>;
    store: KnowledgeStore;
    manifest: IngestManifest;
    /**
     * The packs the root was reviewed with (their parsers re-extract the file). Built WITHOUT a
     * warm symbol index (`reviewPacks({ partitions })`): an index holds the file's definitions
     * from before the edit, and the new content is what must be read.
     */
    packs: readonly KnowledgePack[];
    /** Held entity keys; absent ⇒ read from the store for each batch. */
    knownKeys?: KnownKeysCache;
}

const BASE_SEPARATOR = '|';

/** One edited file: the hash it has now, and the hash it had when the review last judged it. */
interface Edit { hash: string; base: string }

const encodeEdit = (e: Edit): string => `${e.hash}${BASE_SEPARATOR}${e.base}`;

function decodeEdit(value: string): Edit | undefined {
    const at = value.indexOf(BASE_SEPARATOR);
    return at < 0 ? undefined : { hash: value.slice(0, at), base: value.slice(at + 1) };
}

async function reviewedHashes(manifest: IngestManifest, rootId: string): Promise<Map<string, string>> {
    return new Map(((await manifest.get(filesManifestKey(rootId))) ?? []).map((f) => [f.id, f.hash] as const));
}

/** The recorded edits whose base is still the review's hash of that file (an edit without a base is spent). */
async function liveEdits(manifest: IngestManifest, rootId: string, reviewed: ReadonlyMap<string, string>): Promise<Map<string, Edit>> {
    const edits = new Map<string, Edit>();
    for (const f of (await manifest.get(editedManifestKey(rootId))) ?? []) {
        const edit = decodeEdit(f.hash);
        if (edit && reviewed.get(f.id) === edit.base) edits.set(f.id, edit);
    }
    return edits;
}

/** The hash each file has now where it was edited since its review, else the review's. */
export async function currentFileHashes(manifest: IngestManifest, rootId: string): Promise<Map<string, string>> {
    const hashes = await reviewedHashes(manifest, rootId);
    for (const [id, edit] of await liveEdits(manifest, rootId, hashes)) hashes.set(id, edit.hash);
    return hashes;
}

/** Drops the edits a review has superseded (its manifest no longer holds the base they were made on). */
export async function pruneEditedFiles(manifest: IngestManifest, rootId: string): Promise<void> {
    const recorded = (await manifest.get(editedManifestKey(rootId))) ?? [];
    if (recorded.length === 0) return;
    const live = await liveEdits(manifest, rootId, await reviewedHashes(manifest, rootId));
    if (live.size === recorded.length) return;
    await manifest.set(editedManifestKey(rootId), [...live].map(([id, edit]) => ({ id, hash: encodeEdit(edit) })));
}

export interface FileEditResult {
    path: string;
    /** The file was reviewed (it is a source of the graph); an unreviewed file is left alone. */
    reviewed: boolean;
    /** Its claims were marked stale (its content differs from what the graph holds). */
    staled: boolean;
}

/** Reviewed files changed on disk: mark their knowledge stale at the new hashes, re-extract them, move the graph's hashes. */
export async function markFilesEdited(ports: FileEditPorts, rawPaths: readonly string[]): Promise<FileEditResult[]> {
    const { rootId, store } = ports;
    const paths = [...new Set(rawPaths.map(normalizePath))];
    const reviewed = await reviewedHashes(ports.manifest, rootId);
    const edits = await liveEdits(ports.manifest, rootId, reviewed);
    const current = new Map(reviewed);
    for (const [id, edit] of edits) current.set(id, edit.hash);

    const results: FileEditResult[] = [];
    const changed: Array<{ path: string; hash: string; bytes: Uint8Array | undefined }> = [];
    const root = ports.rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    for (const path of paths) {
        if (!current.has(path)) { results.push({ path, reviewed: false, staled: false }); continue; }
        const bytes = await ports.fs.readFile(`${root}/${path}`).catch(() => undefined);
        const hash = bytes ? sha256Hex(bytes) : '';
        const staled = current.get(path) !== hash;
        results.push({ path, reviewed: true, staled });
        if (staled) changed.push({ path, hash, bytes });
    }
    if (changed.length === 0) return results;

    // Read once for the batch: the known entity keys, the composed packs.
    const composed = composePacks(ports.packs);
    const knownKeys = await (ports.knownKeys ?? knownKeysCache(store, rootId)).get();
    let failure: unknown;
    for (const { path, hash, bytes } of changed) {
        try {
            await store.markStale({ rootId }, srcRef(rootId, path), hash);
            const text = bytes ? new TextDecoder('utf-8').decode(bytes) : undefined;
            if (text !== undefined && !isBinaryText(text)) {
                await extractFile({ rootId, path, hash, doc: textDocument(rootId, path, text), packs: ports.packs, store, composed, knownKeys });
            }
            current.set(path, hash);
        } catch (error) {
            failure ??= error; // The rest of the batch still lands.
        }
    }
    // Only what differs from the review is recorded: an edit undone leaves nothing behind.
    await ports.manifest.set(
        editedManifestKey(rootId),
        [...current]
            .filter(([p, h]) => reviewed.has(p) && reviewed.get(p) !== h)
            .map(([id, hash]) => ({ id, hash: encodeEdit({ hash, base: reviewed.get(id)! }) })),
    );
    if (failure !== undefined) throw failure;
    return results;
}

/** One reviewed file changed on disk (see {@link markFilesEdited}). */
export async function markFileEdited(ports: FileEditPorts, rawPath: string): Promise<FileEditResult> {
    return (await markFilesEdited(ports, [rawPath]))[0]!;
}

export interface WatchFileEditsArgs extends FileEditPorts {
    source: DirectorySource;
    /** Edits settle this long before a batch is applied. Default {@link EDIT_DEBOUNCE_MS}. */
    debounceMs?: number;
    /** Told after each batch is applied, with every path the watcher reported (reviewed or not). */
    onEdited?(paths: string[], results: FileEditResult[]): void;
    onError?(error: unknown): void;
}

/** Applies {@link markFilesEdited} to the changes the source's watcher reports, batched; undefined when it cannot watch. */
export function watchFileEdits(args: WatchFileEditsArgs): (() => void) | undefined {
    // One held read of the entity keys for the life of the watch (the host drops it when a review finishes).
    const ports: FileEditPorts = { ...args, knownKeys: args.knownKeys ?? knownKeysCache(args.store, args.rootId) };
    let chain: Promise<unknown> = Promise.resolve();
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // A throwing handler must never stop a later batch.
    const report = (error: unknown): void => { try { args.onError?.(error); } catch { /* the host's handler failed; the watcher goes on */ } };

    const flush = (): void => {
        timer = undefined;
        const paths = [...pending];
        pending = new Set();
        if (paths.length === 0) return;
        chain = chain.then(async () => {
            if (stopped) return;
            let results: FileEditResult[];
            try {
                results = await markFilesEdited(ports, paths);
            } catch (error) {
                report(error);
                results = paths.map((path) => ({ path, reviewed: false, staled: false }));
            }
            args.onEdited?.(paths, results);
        }).catch(report);
    };

    const stopWatching = args.source.watch?.((paths) => {
        for (const p of paths) pending.add(normalizePath(p));
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, args.debounceMs ?? EDIT_DEBOUNCE_MS);
    });
    if (!stopWatching) return undefined;
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        pending = new Set();
        stopWatching();
    };
}
