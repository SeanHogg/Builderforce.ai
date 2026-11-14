/**
 * Fixtures for the pack tests: a docs folder reviewed (no judgement model) under a root id
 * that is NOT a workspace folder — a pack made in another workspace — and an in-memory
 * `Memento` for the loaded-pack registry.
 */
import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { localSnapshotStore } from "@seanhogg/builderforce-memory/knowledge";
import { packFromStore, runKnowledgeReview } from "@builderforce/agent-tools/knowledge";
/** A root id no workspace folder of the tests has. */
export const FOREIGN_ROOT = "vscode:f-foreign-docs";
export const LEASE_DOCS = {
    "lease.md": ["# Lease", "", "## Termination", "", "Either party may terminate the lease with 30 days notice.", ""].join("\n"),
    "policy.md": ["# Policy", "", "Rent is paid monthly.", ""].join("\n"),
};
export function docsSource(rootId, docs) {
    return {
        rootId,
        title: "docs",
        async *list() {
            for (const [p, text] of Object.entries(docs))
                yield { path: p, hash: `h:${p}:${text.length}`, size: text.length };
        },
        async read(p) {
            return { id: p, tenantId: "docs", title: p, content: { kind: "text", text: docs[p] ?? "", mediaType: "text/markdown" } };
        },
    };
}
/** A reviewed docs folder packed as a `.bfpack` payload under `rootId`. */
export async function leasePack(rootId = FOREIGN_ROOT, name = "lease-docs", docs = LEASE_DOCS) {
    let snapshot;
    const store = localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } });
    const manifest = new InMemoryIngestManifest();
    await runKnowledgeReview({ source: docsSource(rootId, docs), store, manifest });
    const extracted = await store.extractedEntries();
    return packFromStore({ name, rootId, title: "Lease docs", store, manifest, extracted });
}
export function memoryMemento(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get: (key) => values.get(key),
        update: (key, value) => { values.set(key, value); return Promise.resolve(); },
    };
}
//# sourceMappingURL=packFixture.test-util.js.map