/**
 * knowledge/manifestBuffer.ts — the review's `IngestManifest` over a buffered store (pure: no node imports, so a browser reuses it).
 *
 * A manifest write is BUFFERED and committed in the SAME transaction as the next fact `apply`, so a manifest can
 * never run ahead of the facts it describes (PRD 41 §B4). `get` reads through the buffer. A `set` that finds no dirty
 * facts to ride with commits on its own (a manifest-only apply). With no fact store at all (on-prem) it commits at once.
 */
/** The buffer both the manifest and the persistence share: the persistence drains it inside each apply. */
export class ManifestBuffer {
    pending = new Map();
    set(sourceId, value) { this.pending.set(sourceId, value); }
    has(sourceId) { return this.pending.has(sourceId); }
    get(sourceId) { return this.pending.get(sourceId); }
    get size() { return this.pending.size; }
    /** Swaps the entries out for one commit (all, or only these source ids). SYNCHRONOUS: what was set before this call is what is taken. */
    take(only) {
        if (!only) {
            const taken = this.pending;
            this.pending = new Map();
            return taken;
        }
        const taken = new Map();
        for (const id of only) {
            if (!this.pending.has(id))
                continue;
            taken.set(id, this.pending.get(id) ?? null);
            this.pending.delete(id);
        }
        return taken;
    }
    /** The commit failed: the taken entries go back UNDER any newer ones. */
    restore(taken) {
        for (const [id, v] of taken)
            if (!this.pending.has(id))
                this.pending.set(id, v);
    }
}
/**
 * The `IngestManifest` over a buffer. `persistFacts` (the fact store's flush) is how a `set` rides with dirty facts; absent, a
 * `set` commits directly.
 */
export function bufferedManifest(buffer, sink, persistFacts) {
    const settle = async (sourceId) => {
        if (persistFacts)
            await persistFacts(); // an apply drains the buffer in its own transaction when facts are dirty
        // Nothing was dirty: a manifest-only apply of THIS entry only (another entry may describe facts that are not applied yet).
        if (buffer.has(sourceId))
            await sink.commitBuffered([sourceId]);
    };
    return {
        async get(sourceId) {
            if (buffer.has(sourceId))
                return buffer.get(sourceId) ?? undefined;
            return await sink.readCommitted(sourceId);
        },
        async set(sourceId, fingerprints) {
            sink.assertWritable();
            buffer.set(sourceId, fingerprints.map((f) => ({ id: f.id, hash: f.hash })));
            await settle(sourceId);
        },
        async delete(sourceId) {
            sink.assertWritable();
            buffer.set(sourceId, null);
            await settle(sourceId);
        },
    };
}
//# sourceMappingURL=manifestBuffer.js.map