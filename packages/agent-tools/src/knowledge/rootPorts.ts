/**
 * knowledge/rootPorts.ts — ONE `IngestManifest` per root, per host process, and one
 * `KnowledgeStore` per root and store variant (PRD 38 §4.3, §5.2).
 *
 * A local store and a file manifest each hold their state in memory and write it back whole:
 * two handles on one root — the review's and a file watcher's — would each write the
 * snapshot they read first, and the later write would erase what the other did (a watcher
 * persisting its pre-review copy over a finished review). So every user of a root (the
 * review, the live watcher, the editor's graph reads) takes its ports from here and shares
 * the pair.
 *
 * The MANIFEST is a file beside the root's files: whichever store the root is reviewed
 * against (the local snapshot, or a linked project), that record is the same one, so it is
 * keyed by the root (and where its file lives) only. The STORE is keyed by `variant` too —
 * the linked project, or `local`: the same root against another project is another store.
 */

import type { KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';

export interface RootPorts {
    store: KnowledgeStore;
    manifest: IngestManifest;
}

const manifests = new Map<string, IngestManifest>();
const stores = new Map<string, KnowledgeStore>();
const SEP = '\u0000';

/** The root's manifest; `open` runs only the first time (per root and file location). */
export function rootManifest(rootId: string, open: () => IngestManifest, location = ''): IngestManifest {
    const key = `${rootId}${SEP}${location}`;
    let held = manifests.get(key);
    if (!held) manifests.set(key, (held = open()));
    return held;
}

/** The root's store for `variant`; `open` runs only the first time (per root and variant). */
export function rootStore(rootId: string, open: () => KnowledgeStore, variant = 'local'): KnowledgeStore {
    const key = `${rootId}${SEP}${variant}`;
    let held = stores.get(key);
    if (!held) stores.set(key, (held = open()));
    return held;
}

/** Both at once (see {@link rootManifest}, {@link rootStore}). */
export function rootPorts(
    rootId: string,
    open: { store(): KnowledgeStore; manifest(): IngestManifest },
    opts: { variant?: string; location?: string } = {},
): RootPorts {
    return { store: rootStore(rootId, open.store, opts.variant), manifest: rootManifest(rootId, open.manifest, opts.location) };
}

/** Forget a root's ports (tests; a host that rewrote the files under them). No root ⇒ all. */
export function forgetRootPorts(rootId?: string): void {
    if (rootId === undefined) { manifests.clear(); stores.clear(); return; }
    for (const map of [manifests, stores] as const) {
        for (const key of [...map.keys()]) if (key.startsWith(`${rootId}${SEP}`)) map.delete(key);
    }
}
