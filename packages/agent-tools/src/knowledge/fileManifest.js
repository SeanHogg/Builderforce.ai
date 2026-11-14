/**
 * knowledge/fileManifest.ts — the file names under the workspace's `.builderforce/knowledge/`
 * (the ONE root-file rule, `rootFileStem`, shared with the knowledge index's `.idx` files), the
 * {@link KnowledgeFiles} port, and the legacy root-id move. A root's review manifest and local graph
 * are rows in the SQLite store (`node-knowledge-store`); the `<stem>.json`, `<stem>.manifest.json`
 * and `<stem>.extracted.jsonl` names remain only so that store can import and rename them. Pure
 * over {@link KnowledgeFiles}.
 */
import { rootFileStem } from './index/persistence.js';
export const snapshotFileName = (rootId) => `${rootFileStem(rootId)}.json`;
/** The root's extract cache (PRD 41 A10): an append-only JSON Lines log beside its snapshot, content-addressed bodies the snapshot no longer holds. */
export const extractedLogFileName = (rootId) => `${rootFileStem(rootId)}.extracted.jsonl`;
export const manifestFileName = (rootId) => `${rootFileStem(rootId)}.manifest.json`;
/** The root's replica queue (PRD 41 A7): what is still to be sent to the linked project, beside its snapshot. */
/** The op log older versions kept (PRD 41 A7); read once to migrate, then deleted. */
export const replicaFileName = (rootId) => `${rootFileStem(rootId)}.replica.json`;
/** The replica's dirty set and ack (PRD 41 A11). */
export const dirtyFileName = (rootId) => `${rootFileStem(rootId)}.dirty.json`;
/** The analysis snapshot waiting for the next pack: its own file, so the dirty set stays small. */
export const analysisPendingFileName = (rootId) => `${rootFileStem(rootId)}.analysis-pending.json`;
/** A review run's record (PRD 41 A8), in the `runs/` folder; the root's ordered list of them is `runsIndexFileName`. */
export const runFileName = (runId) => `runs/${runId}.json`;
export const runsIndexFileName = (rootId) => `runs/${rootFileStem(rootId)}.index.json`;
/** Fields that hold a person's or the model's words, never a root id. */
const PROSE_FIELDS = new Set(['title', 'label', 'content', 'quote', 'text', 'name', 'claim']);
/** A string with the legacy root id moved to the new one, wherever it names the root. */
function movedRootString(value, from, to) {
    if (value === from)
        return to;
    let out = value.split(`src:${from}::`).join(`src:${to}::`);
    if (out === `knowledge:${from}` || out.startsWith(`knowledge:${from}:`))
        out = `knowledge:${to}${out.slice(`knowledge:${from}`.length)}`;
    return out;
}
/** A JSON value with root `from` moved to `to` everywhere it names the root (refs, root-id fields, record keys); prose is left alone. Also how a portable pack is re-keyed (`rebasePackRoot`). */
export function moveRoot(value, from, to, field) {
    if (typeof value === 'string')
        return field && PROSE_FIELDS.has(field) ? value : movedRootString(value, from, to);
    if (Array.isArray(value))
        return value.map((v) => moveRoot(v, from, to, field));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[movedRootString(k, from, to)] = moveRoot(v, from, to, k);
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
export function migratingRootFiles(files, rootId, legacyRootId) {
    if (!legacyRootId || legacyRootId === rootId)
        return files;
    const legacyName = new Map([
        [snapshotFileName(rootId), snapshotFileName(legacyRootId)],
        [manifestFileName(rootId), manifestFileName(legacyRootId)],
    ]);
    return {
        async read(name) {
            const own = await files.read(name);
            const old = legacyName.get(name);
            if (own !== undefined || !old)
                return own;
            const text = await files.read(old);
            if (text === undefined)
                return undefined;
            let moved;
            try {
                moved = JSON.stringify(moveRoot(JSON.parse(text), legacyRootId, rootId));
            }
            catch {
                return undefined; // A corrupt legacy file is no file: the review re-plans.
            }
            await files.write(name, moved);
            return moved;
        },
        write: (name, text) => files.write(name, text),
        ...(files.append ? { append: (name, text) => files.append(name, text) } : {}),
        ...(files.rename ? { rename: (from, to) => files.rename(from, to) } : {}),
        ...(files.remove ? { remove: (name) => files.remove(name) } : {}),
        ...(files.list ? { list: (folder) => files.list(folder) } : {}),
    };
}
//# sourceMappingURL=fileManifest.js.map