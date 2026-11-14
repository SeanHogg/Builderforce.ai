/**
 * The editor's PACK REGISTRY (PRD 40): which portable knowledge packs this extension has
 * loaded or created, remembered across sessions in `globalState`. It implements the shared
 * `PackRegistry` seam (`@builderforce/agent-tools/knowledge-index`) — a list, nothing more —
 * so chat, the context pack and the knowledge panel all ask the same place which packs exist.
 *
 * Owns the ONE storage key and the record shape. A pack is keyed by its ROOT (the same
 * file-safe stem the knowledge files use, `rootFileStem`), never by its display name: two
 * folders called `docs` in different workspaces are two packs. The record also keeps what the
 * knowledge view lists (title, packs, last review) so listing a pack reads no file. Records
 * written before that — keyed by name — are read as they are and migrated on the next write.
 *
 * Configured at activation (like `configureHostKnowledgeIndex`); before that (tests, the
 * harness) it holds its records in memory. No `vscode` import: a `Memento` is only a `get`/`update` pair.
 */
import { rootFileStem } from "@builderforce/agent-tools/knowledge-index";
/** The ONE globalState key recording the packs loaded in this extension (registry key → record). */
export const KNOWLEDGE_PACKS_KEY = "builderforce.knowledge.packs";
/** The record a pack file stands for (what the knowledge view lists, so no file is read for it). */
export function recordOfPack(pack, filePath, loadedAt = pack.createdAt) {
    const scope = pack.snapshot.scopes.find((s) => s.rootId === pack.rootId);
    return {
        path: filePath,
        rootId: pack.rootId,
        title: pack.title,
        loadedAt,
        ...(scope?.packs ? { packs: scope.packs } : {}),
        ...(scope?.lastReviewedAt ? { lastReviewedAt: scope.lastReviewedAt } : {}),
        ...(pack.provenance ? { provenance: pack.provenance } : {}),
    };
}
function inMemory() {
    const values = new Map();
    return {
        get: (key) => values.get(key),
        update: (key, value) => { values.set(key, value); return Promise.resolve(); },
    };
}
let memento = inMemory();
/** Activation (and tests): where the loaded packs are remembered. */
export function configureLoadedPacks(state) {
    memento = state;
}
/**
 * The records, keyed by their root's stem. A record stored under another key (one written by
 * name, before packs were keyed by root) is read under its root's stem with that key as its
 * name; where both exist the root-keyed record wins. Malformed records are skipped.
 */
function records() {
    const read = memento.get(KNOWLEDGE_PACKS_KEY);
    if (!read || typeof read !== "object")
        return {};
    const out = {};
    const legacy = {};
    for (const [key, value] of Object.entries(read)) {
        const r = value;
        if (!r || typeof r.path !== "string" || typeof r.rootId !== "string")
            continue;
        const stem = rootFileStem(r.rootId);
        const record = {
            path: r.path,
            rootId: r.rootId,
            loadedAt: typeof r.loadedAt === "string" ? r.loadedAt : "",
            name: typeof r.name === "string" ? r.name : key,
            ...(typeof r.title === "string" ? { title: r.title } : {}),
            ...(Array.isArray(r.packs) ? { packs: r.packs.filter((p) => typeof p === "string") } : {}),
            ...(typeof r.lastReviewedAt === "string" ? { lastReviewedAt: r.lastReviewedAt } : {}),
            ...(r.provenance && typeof r.provenance === "object" ? { provenance: r.provenance } : {}),
        };
        (key === stem ? out : legacy)[stem] = record;
    }
    return { ...legacy, ...out };
}
const entryOf = (r) => ({ name: r.name, rootId: r.rootId, title: r.title || r.name, path: r.path, loadedAt: r.loadedAt });
const all = () => Object.values(records()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(entryOf);
const find = (rootId) => Object.values(records()).find((r) => r.rootId === rootId);
const registry = {
    all,
    list: () => Promise.resolve(all()),
    byRootId: (rootId) => { const r = find(rootId); return r ? entryOf(r) : undefined; },
    recordOf: find,
    remember: (name, record) => Promise.resolve(memento.update(KNOWLEDGE_PACKS_KEY, { ...records(), [rootFileStem(record.rootId)]: { ...record, name } })),
    forget(nameOrRootId) {
        const kept = Object.fromEntries(Object.entries(records()).filter(([, r]) => r.name !== nameOrRootId && r.rootId !== nameOrRootId));
        return Promise.resolve(memento.update(KNOWLEDGE_PACKS_KEY, kept));
    },
};
/** The editor's loaded-pack registry. */
export function loadedPackRegistry() {
    return registry;
}
//# sourceMappingURL=loadedPackRegistry.js.map