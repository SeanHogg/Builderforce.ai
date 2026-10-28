/**
 * knowledge/fileManifest.ts — a root's review `IngestManifest` (and its local snapshot's
 * name) as files in the workspace's `.builderforce/knowledge/`, for every host that
 * reviews on a disk (VS Code, on-prem). File names follow the ONE root-file rule
 * (`rootFileStem`, shared with the knowledge index's `.idx` files). Pure over
 * {@link KnowledgeFiles}.
 */

import type { ChunkFingerprint, IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { rootFileStem } from './index/persistence.js';

/** Named text files in one folder (`.builderforce/knowledge/`). */
export interface KnowledgeFiles {
    read(name: string): Promise<string | undefined>;
    write(name: string, text: string): Promise<void>;
}

export const snapshotFileName = (rootId: string): string => `${rootFileStem(rootId)}.json`;
export const manifestFileName = (rootId: string): string => `${rootFileStem(rootId)}.manifest.json`;

type ManifestRecord = Record<string, ChunkFingerprint[]>;

/** The root's review manifest, persisted whole on every change (it is small), writes serialized. */
export function fileManifest(files: KnowledgeFiles, name: string): IngestManifest {
    let record: ManifestRecord | undefined;
    let queue: Promise<unknown> = Promise.resolve();
    const load = async (): Promise<ManifestRecord> => {
        if (!record) {
            try {
                const parsed = JSON.parse((await files.read(name)) ?? '{}') as unknown;
                record = parsed && typeof parsed === 'object' ? (parsed as ManifestRecord) : {};
            } catch {
                record = {}; // A corrupt manifest plans every file as changed: slower, never wrong.
            }
        }
        return record;
    };
    const mutate = (fn: (r: ManifestRecord) => void): Promise<void> => {
        const run = queue.then(async () => {
            const r = await load();
            fn(r);
            await files.write(name, JSON.stringify(r));
        });
        queue = run.catch(() => undefined);
        return run;
    };
    return {
        async get(sourceId) {
            await queue;
            return (await load())[sourceId];
        },
        set: (sourceId, fingerprints) => mutate((r) => { r[sourceId] = fingerprints; }),
        delete: (sourceId) => mutate((r) => { delete r[sourceId]; }),
    };
}

/** Fields that hold a person's or the model's words, never a root id. */
const PROSE_FIELDS: ReadonlySet<string> = new Set(['title', 'label', 'content', 'quote', 'text', 'name', 'claim']);

/** A string with the legacy root id moved to the new one, wherever it names the root. */
function movedRootString(value: string, from: string, to: string): string {
    if (value === from) return to;
    let out = value.split(`src:${from}::`).join(`src:${to}::`);
    if (out === `knowledge:${from}` || out.startsWith(`knowledge:${from}:`)) out = `knowledge:${to}${out.slice(`knowledge:${from}`.length)}`;
    return out;
}

function moveRoot(value: unknown, from: string, to: string, field?: string): unknown {
    if (typeof value === 'string') return field && PROSE_FIELDS.has(field) ? value : movedRootString(value, from, to);
    if (Array.isArray(value)) return value.map((v) => moveRoot(v, from, to, field));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[movedRootString(k, from, to)] = moveRoot(v, from, to, k);
        return out;
    }
    return value;
}

/**
 * A root's files with its LEGACY files migrated on first read (the root-id rule moved,
 * PRD 38 §4.2): when the snapshot or manifest under the root's id is absent but one under
 * `legacyRootId` exists, it is read, its root id rewritten (the scope, `src:` refs,
 * manifest keys), written under the new name and returned — so nobody loses a local graph.
 * The legacy file is left in place.
 */
export function migratingRootFiles(files: KnowledgeFiles, rootId: string, legacyRootId: string | undefined): KnowledgeFiles {
    if (!legacyRootId || legacyRootId === rootId) return files;
    const legacyName = new Map([
        [snapshotFileName(rootId), snapshotFileName(legacyRootId)],
        [manifestFileName(rootId), manifestFileName(legacyRootId)],
    ]);
    return {
        async read(name) {
            const own = await files.read(name);
            const old = legacyName.get(name);
            if (own !== undefined || !old) return own;
            const text = await files.read(old);
            if (text === undefined) return undefined;
            let moved: string;
            try {
                moved = JSON.stringify(moveRoot(JSON.parse(text) as unknown, legacyRootId, rootId));
            } catch {
                return undefined; // A corrupt legacy file is no file: the review re-plans.
            }
            await files.write(name, moved);
            return moved;
        },
        write: (name, text) => files.write(name, text),
    };
}
