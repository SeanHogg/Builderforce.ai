/**
 * delta/adapters/l3Cache.ts — THE L3 result cache (PRD 41 §B7, B8.3), shared by the two places that run the whole-tree
 * analyzers: the background indexer's L3 pass (`analyseWorkspace`, through `createAnalyzeCodebaseTool`) and the run
 * delta's analyzer tier (the host's `repoAnalyzers`). One key, one entry shape, one store (the host's port):
 *
 *   key    {@link l3CacheKey} — tool + its pinned version, the configuration hash (ignored folders, the layer registry,
 *          the offline database's date), the hash of the tool's declared input files, and the tree's content hash;
 *   entry  {@link L3CacheEntry} — the normalized run-delta `AnalyzerResult` (what the delta reads), and the tool's raw
 *          report (what the indexer's analysis snapshot is built from), when the writer had it.
 *
 * So the run delta reuses the indexer's results for the base commit's tree, and the indexer reuses a delta's: whichever
 * ran first. Pure (the store and the key's parts are the host's).
 */
import { sha256Hex } from '@seanhogg/builderforce-memory/retrieval';
/** Bumps when the entry shape or an adapter's normalization changes (every old entry then misses). */
export const L3_CACHE_VERSION = 3;
export const l3CacheKey = (k) => sha256Hex(JSON.stringify([L3_CACHE_VERSION, k.tool, k.version, k.config, k.inputs, k.tree]));
/** A result read for another side: every evidence row on that side. */
export function onSide(result, side) {
    return { ...result, findings: result.findings.map((f) => ({ ...f, evidence: f.evidence.map((e) => ({ ...e, side })) })) };
}
//# sourceMappingURL=l3Cache.js.map