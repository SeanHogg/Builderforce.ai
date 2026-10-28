/**
 * `@builderforce/agent-tools/knowledge-index` — the HOST-AGNOSTIC half of a local host's
 * knowledge index (docs/design/deterministic-knowledge-index.md, WS3): the registry of
 * every root's index over injected files, warm embedders and an idle scheduler; the
 * code-pack seed; the
 * `knowledge.ask` row and executor; the hit renderer. The editor
 * (`clients/vscode/src/knowledge/index/`) and on-prem (`agent-runtime/src/agents/knowledge/index/`)
 * supply only their ports. Pure: no fs, no model.
 */

export type {
    HitMeta, HostKnowledgeIndex, HostKnowledgeIndexCore, IdleScheduler, KnowledgeIndexFiles, Recall, RecalledHit, WarmEmbedderSource,
} from './contract.js';
export { EMBEDDER_ORDER, batchEmbedder, idleLoadedEmbedder, resolveWarmEmbedder, type IdleLoadedEmbedderOptions } from './embedderChain.js';
export {
    KNOWLEDGE_INDEX_DIR, KNOWLEDGE_INDEX_EXT, indexFileName, rootFileStem, knowledgeIndexDir, knowledgeIndexPath, readStoredIndex, writeIndexAtomic,
} from './persistence.js';
export { KNOWLEDGE_IDLE_MS, debouncedIdle } from './idle.js';
export { COMPACT_CHURN, NEAR_DUPLICATE_MAX_PAIRS, NEAR_DUPLICATE_MIN, createHostKnowledgeIndex, type HostIndexOptions } from './hostIndex.js';
export {
    RESEED_DEBOUNCE_MS, createKnowledgeIndexRegistry, readSeedPartitions,
    type KnowledgeIndexRegistry, type KnowledgeIndexRegistryOptions,
} from './registry.js';
export { SEED_CHUNK_FILES, chunkByArea, extractFromSymbols, seedCodeCards, type SymbolFile } from './seedCode.js';
export {
    HIT_EXCERPT_CHARS, SINGLE_TIER_WEIGHT, hitConfidence, hitLine, renderKnowledgeAnswer, renderKnowledgeContext, shownHits,
    type RenderHitsOptions,
} from './renderHits.js';
export {
    KNOWLEDGE_ASK, KNOWLEDGE_ASK_BUDGET_MS, KNOWLEDGE_ASK_ROW, knowledgeAskExecutor, knowledgeSubject, type KnowledgeAskHost,
} from './knowledgeAsk.js';
export { NEIGHBOUR_SCORE_SHARE, searchRecall, type SearchRecallPorts } from './searchRecall.js';
