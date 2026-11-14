/**
 * The HOST knowledge index's contract (docs/design/deterministic-knowledge-index.md,
 * "Where it runs") — what the editor and the on-prem runtime hold per reviewed root over
 * memory's deterministic engine (`@seanhogg/builderforce-memory/knowledge`):
 *
 *   - {@link HostKnowledgeIndex}: the PINNED surface the knowledge host (review runner,
 *     graph panel, stores) imports — search, near-duplicates, upsert from a graph;
 *   - {@link HostKnowledgeIndexCore}: that plus what this package's own consumers read
 *     (recall with one-hop expansion for `knowledge.ask` and the context pack);
 *   - the host's ports: its files ({@link KnowledgeIndexFiles}), its warm embedders
 *     ({@link WarmEmbedderSource}) and its idle scheduler.
 *
 * Pure: no fs, no model. Each host injects its own.
 */
export {};
//# sourceMappingURL=contract.js.map