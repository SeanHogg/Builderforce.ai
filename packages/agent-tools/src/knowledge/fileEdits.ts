/**
 * knowledge/fileEdits.ts — an edited source makes what was judged from it stale (PRD 38
 * §5.2, WS5): the moment a reviewed file changes on disk, its model facts and relations are
 * marked stale at the file's NEW content hash, its perception is re-extracted by that hash,
 * and the hash the graph is built with moves to it — so `buildGraph` shows the claims
 * stale until the next review judges the new text. No model call, nothing deleted.
 *
 * The review's own manifest is NOT moved: a later review still sees the file as changed and
 * judges it again. The new hash lives beside it (`knowledge:<root>:edited`) and
 * {@link buildStoredGraph} reads it over the review's.
 *
 * ONE helper for every host that watches a reviewed folder (the editor's live graph, the
 * on-prem agent after a review). Pure over ports.
 */

import {
    composePacks, entityName, filesManifestKey, isBinaryPath, isBinaryText, knownKeysOf, nameResolver, resolveEntities,
    resolveRelativePath, sha256Hex, srcRef,
    type DirectorySource, type Extracted, type KnowledgePack, type KnowledgeStore, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { normalizePath, textDocument, type KnowledgeFs } from './fsDirectorySource.js';

/** Manifest entry naming the content hash each edited file has NOW (path → hash; '' = deleted). */
export const editedManifestKey = (rootId: string): string => `knowledge:${rootId}:edited`;

export interface FileEditPorts {
    rootId: string;
    /** Absolute path of the reviewed folder. */
    rootPath: string;
    fs: Pick<KnowledgeFs, 'readFile'>;
    store: KnowledgeStore;
    manifest: IngestManifest;
    /** The packs the root was reviewed with (their parsers re-extract the file). */
    packs: readonly KnowledgePack[];
}

/** The hash each file has now where it was edited since its review, else the review's. */
export async function currentFileHashes(manifest: IngestManifest, rootId: string): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    for (const f of (await manifest.get(filesManifestKey(rootId))) ?? []) hashes.set(f.id, f.hash);
    for (const f of (await manifest.get(editedManifestKey(rootId))) ?? []) hashes.set(f.id, f.hash);
    return hashes;
}

async function reextract(ports: FileEditPorts, path: string, hash: string, bytes: Uint8Array, files: readonly string[]): Promise<void> {
    if (isBinaryPath(path)) return;
    const text = new TextDecoder('utf-8').decode(bytes);
    if (isBinaryText(text)) return;
    const doc = textDocument(ports.rootId, path, text);
    const hit = composePacks(ports.packs).resolve(doc);
    if (!hit?.parser.extract) return;
    const entities = (await ports.store.facts({ rootId: ports.rootId })).filter((f) => f.key.startsWith('ent:'));
    const ex: Extracted = {
        ...hit.parser.extract(doc, hit.parser.parse(doc), {
            rootId: ports.rootId,
            knownKeys: knownKeysOf(resolveEntities(entities.map((f) => ({ ref: f.key as NodeRef, key: entityName(f.key) })))),
            resolvePath: resolveRelativePath,
            resolveName: nameResolver(files),
        }),
        sourceHash: hash,
    };
    const ref = srcRef(ports.rootId, path);
    const cached = (await ports.store.getExtracted?.(hash)) ?? [];
    await ports.store.putExtracted?.(hash, [...cached.filter((e) => e.sourceRef !== ref), ex]);
}

export interface FileEditResult {
    path: string;
    /** The file was reviewed (it is a source of the graph); an unreviewed file is left alone. */
    reviewed: boolean;
    /** Its claims were marked stale (its content differs from what the graph holds). */
    staled: boolean;
}

/** One reviewed file changed on disk: mark its knowledge stale at the new hash, re-extract, move the graph's hash. */
export async function markFileEdited(ports: FileEditPorts, rawPath: string): Promise<FileEditResult> {
    const path = normalizePath(rawPath);
    const hashes = await currentFileHashes(ports.manifest, ports.rootId);
    if (!hashes.has(path)) return { path, reviewed: false, staled: false };

    const bytes = await ports.fs.readFile(`${ports.rootPath.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`).catch(() => undefined);
    const hash = bytes ? sha256Hex(bytes) : '';
    if (hashes.get(path) === hash) return { path, reviewed: true, staled: false };

    await ports.store.markStale({ rootId: ports.rootId }, srcRef(ports.rootId, path), hash);
    if (bytes) await reextract(ports, path, hash, bytes, [...hashes.keys()]);
    hashes.set(path, hash);
    const reviewed = new Map(((await ports.manifest.get(filesManifestKey(ports.rootId))) ?? []).map((f) => [f.id, f.hash] as const));
    // Only what differs from the review is recorded: an edit undone leaves nothing behind.
    await ports.manifest.set(
        editedManifestKey(ports.rootId),
        [...hashes].filter(([p, h]) => reviewed.get(p) !== h).map(([id, h]) => ({ id, hash: h })),
    );
    return { path, reviewed: true, staled: true };
}

export interface WatchFileEditsArgs extends FileEditPorts {
    source: DirectorySource;
    /** Told after each batch is applied, with every path the watcher reported (reviewed or not). */
    onEdited?(paths: string[], results: FileEditResult[]): void;
    onError?(error: unknown): void;
}

/** Applies {@link markFileEdited} to every change the source's watcher reports; undefined when it cannot watch. */
export function watchFileEdits(args: WatchFileEditsArgs): (() => void) | undefined {
    let chain: Promise<unknown> = Promise.resolve();
    return args.source.watch?.((paths) => {
        chain = chain.then(async () => {
            const results: FileEditResult[] = [];
            for (const p of paths) results.push(await markFileEdited(args, p).catch((error: unknown) => { args.onError?.(error); return { path: p, reviewed: false, staled: false }; }));
            args.onEdited?.(paths, results);
        });
    });
}
