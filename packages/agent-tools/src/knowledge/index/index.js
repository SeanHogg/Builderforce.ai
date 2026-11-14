/**
 * `@builderforce/agent-tools/knowledge-index` — the HOST-AGNOSTIC half of a local host's
 * knowledge index (docs/design/deterministic-knowledge-index.md, WS3): the registry of
 * every root's index over injected files, warm embedders and an idle scheduler; the
 * code-pack seed; the
 * `knowledge.ask` row and executor; the hit renderer. The editor
 * (`clients/vscode/src/knowledge/index/`) and on-prem (`agent-runtime/src/agents/knowledge/index/`)
 * supply only their ports. Pure: no fs, no model.
 */
export { EMBEDDER_ORDER, batchEmbedder, idleLoadedEmbedder, resolveWarmEmbedder } from './embedderChain.js';
export { KNOWLEDGE_INDEX_DIR, KNOWLEDGE_INDEX_EXT, indexFileName, rootFileStem, knowledgeIndexDir, knowledgeIndexPath, readStoredIndex, writeIndexAtomic, } from './persistence.js';
export { KNOWLEDGE_IDLE_MS, debouncedIdle } from './idle.js';
export { COMPACT_CHURN, NEAR_DUPLICATE_MAX_PAIRS, NEAR_DUPLICATE_MIN, createHostKnowledgeIndex } from './hostIndex.js';
export { RESEED_DEBOUNCE_MS, createKnowledgeIndexRegistry, readSeedPartitions, } from './registry.js';
export { SEED_CHUNK_FILES, chunkByArea, extractFromSymbols, seedCodeCards } from './seedCode.js';
export { HIT_EXCERPT_CHARS, SINGLE_TIER_WEIGHT, hitConfidence, hitLine, renderKnowledgeAnswer, renderKnowledgeContext, shownHits, } from './renderHits.js';
export { KNOWLEDGE_ASK, KNOWLEDGE_ASK_BUDGET_MS, KNOWLEDGE_ASK_ROW, knowledgeAskExecutor, knowledgeSubject, } from './knowledgeAsk.js';
export { mergeRecalls, packRetrievalPort, withPacks, } from './packRetrieval.js';
export { NEIGHBOUR_SCORE_SHARE, searchRecall } from './searchRecall.js';
//# sourceMappingURL=index.js.map