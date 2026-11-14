/**
 * `@builderforce/agent-tools/knowledge` — the code pack for memory's knowledge graph
 * (PRD 38 §4.4–4.5, `docs/specs/38-prd-knowledge-graph.md`). Memory
 * (`@seanhogg/builderforce-memory/knowledge`) owns the graph; this supplies what code means.
 *
 * Pure and Worker-safe: the API builds graphs from uploaded snapshots with
 * {@link repoGraphToExtracted} and {@link analysisToExtracted}. The analyzers themselves run
 * through a surface's shell capability, injected by the host.
 */
export { CODE_LAYERS, CODE_PARTITIONS_FILE, codeParser, createCodePack, isCodePackPath, isCodePath, loadCodePartitions, } from './codePack.js';
export { knowledgePacks } from './knowledgePacks.js';
export { analysisToExtracted, analysisToExtractedYielding, repoGraphToExtracted } from './codeExtracted.js';
export { codeAnalyzers, runCodeAnalysis } from './codeAnalyzers.js';
export { CODE_FACT_RULES, CODE_FINDING_RULES, unusedCodeRule } from './codeFindings.js';
// PRD 41 §B3: FileFacts v3 from one parse tree (pure; the Node parse is `./node-file-facts`).
export { fileFactsOf, cappedFileFacts, isCappedFacts, CAPPED_EXTRACTOR, FILE_FACTS_LANGUAGES } from './facts/fileFactsOf.js';
export { importResolver, pythonModuleCandidates } from './facts/importResolver.js';
export { resolveFileFacts, resolutionKey, resolvedKey, unresolveFileFacts, candidateMount, isRouterFacts, hasCandidateMounts, CANDIDATE_MOUNT, CHAIN_IMPORT, } from './facts/resolveFacts.js';
export { CODE_BADGES, CODE_PACK_ID, ROOT_OUTPUT_HASH_PREFIX, codeFileNode } from './codeNodes.js';
export { LAYER_RULE_PREFIX, toDependencyCruiserRules, } from './dependencyCruiserRules.js';
export { KNOWLEDGE_REVIEW_MODEL_CALLS, analysisManifestKey, analysisSha, buildStoredGraph, planKnowledgeReview, planKnowledgeReviewDetail, reviewIndexPort, reviewPacks, rootModuleResolution, runKnowledgeReview, storedFileHashes, workspaceCodeAnalyzers, } from './reviewRunner.js';
export { indexedSymbolLookup, indexedSymbolSource } from './indexedSymbols.js';
export { planDetailLine, reviewReportText } from './reviewText.js';
export { LOCAL_COST_TEXT, reviewCostOf, reviewCostSuffix, } from './reviewCost.js';
export { KNOWLEDGE_COMPARE_SYSTEM, KNOWLEDGE_EXTRACT_SYSTEM, MAX_JUDGE_TEXT, completionJudgement, fallbackJudgement, judgeWith, replyJson, } from './judgement.js';
export { HUMAN_FACT_SOURCE, humanFactBatch, humanFactKey } from './humanFact.js';
export { KNOWLEDGE_SKIP_DIRS, MAX_LISTED_FILES, createFsDirectorySource, isBuilderforceState, isSkippedPath, listsFile, normalizePath, textDocument, } from './fsDirectorySource.js';
export { deferredHashCache, memoryHashCache, reusedHash } from './statManifest.js';
export { documentDoc, EXTRACTABLE_DOCUMENT_MEDIA_TYPES, extractDocumentText, withDocumentText } from './documents/index.js';
export { extractedLogFileName, manifestFileName, migratingRootFiles, analysisPendingFileName, dirtyFileName, replicaFileName, runFileName, runsIndexFileName, snapshotFileName } from './fileManifest.js';
export { createReplicaQueue, memoryReplicaPersistence, queuedRootIdOf, relationKey, factKey, fileKey, } from './replicaQueue.js';
export { replicatedKnowledgeStore } from './replicatedStore.js';
export { GENERATION_CHECK_INTERVAL_MS, emptyReplicaState, pumpReplica } from './replicaPump.js';
export { buildPack, DIFF_MAX_FILES } from './replicaPack.js';
export { knowledgeComparability, knowledgeMeasuredWith, knowledgeSideMeta, MEASURED_UNKNOWN, PACK_TOOL_PREFIX } from './measuredWith.js';
export { hasControlChar, isCleanKey, isCleanText, isWellFormedString } from './packKeyGuard.js';
export { planReconcile } from './replicaReconcile.js';
export { currentSourcesOf, enqueueFirstSync, enqueueSources } from './replicaFirstSync.js';
export { PACK_ROOT_HOST, folderIdOf, isPackRootId, isWellFormedPackRootId, packRootIdFor, repoIdOfRemote, rootIdFor, rootIdOfSourceRef, rootRelOf, sourcePathOf, splitSourceRef } from './rootId.js';
export { canDeleteFact, factRightsCache, } from './factRights.js';
export { createShaCache } from './shaCache.js';
export { FINGERPRINT_TTL_MS, GIT, fingerprintSha, forgetWorkspaceFingerprints, gitText, workspaceFingerprint, } from './workspaceFingerprint.js';
export { folderPrefix, repoGraphUnder, snapshotUnder, underFolder } from './rootRelative.js';
export { forgetRootPorts, rootManifest, rootPorts, rootStore } from './rootPorts.js';
export { analyseWorkspace, analysisKeep, graphAcceptsOf, forgetWorkspaceAnalyses, readRepoGraph, workspaceAnalysisKey, } from './workspaceAnalysis.js';
export { analyseWorkspaceExtracted, } from './workspaceExtracted.js';
export { mapYielding, YIELD_EVERY, yieldToEventLoop } from './yieldLoop.js';
export { EDIT_DEBOUNCE_MS, currentFileHashes, editedManifestKey, knownKeysCache, markFileEdited, markFilesEdited, markFilesEditedDetailed, pruneEditedFiles, watchFileEdits, } from './fileEdits.js';
export { claimSimilarity } from './claimSimilarity.js';
export { provenanceLine } from './packProvenance.js';
export { mergePacks, packFromSnapshot, parsePack, rebasePackRoot, serializePack, } from './portablePack.js';
export { mergePacksWithCards, packFromStore, packGraph, reviewHasWork } from './packGraph.js';
export { buildCodeGraph } from './codeGraph.js';
export { NO_MODULE_ALIASES, PACKAGE_MODULE_DIR, aliasCandidates, aliasesOf, isAliasSpecifier, parseConfigText, resolveImportPath, } from './moduleAliases.js';
export { ModuleAliasCache } from './moduleAliasLoader.js';
export { fileRollup, moduleFileCandidates, moduleFileOf, repointRollupEdges } from './codeRollup.js';
export { LAYER_IDS, isDefaultLayers } from './codeLayers.js';
export { coverageSourceState } from './codeCoverage.js';
export { istanbulLineHits, lcovLineHits } from './codeCoverage.js';
export { CHURN_DAYS, HISTORY_DAYS, HISTORY_MAX_COMMITS, churnCapWarning, churnOf } from './historyPort.js';
export { isSkippedDirName, isVcsMetadataName } from '../skipDirs.js';
export { CODEOWNERS_LOCATIONS } from './codeOwners.js';
export { blobDataUrl } from './blobDataUrl.js';
export { gatewayErrorMessage } from './gatewayError.js';
export { createReviewRecorder, graphCounts, repoGraphEdgeCount, reviewRecordStore, } from './reviewRecord.js';
export { MAX_PINPOINT_IMAGE_BYTES, MAX_PINPOINT_MATCHES, MAX_PINPOINT_TEXTS, PINPOINT_VISION_MAX_TOKENS, PINPOINT_VISION_SYSTEM, checkPinpointDataUrl, checkPinpointImage, cleanTexts, isCatalogPath, keysOfValue, matchAnchors, parseVisionReply, pinpointVisionRequest, } from './pinpointMatch.js';
export { COPY_SAMPLE, COPY_SIMILARITY, detectSystems, duplicateCopies, manifestProjectName, } from './systems.js';
export { graphSystems, readSystems, recordSystems, systemsManifestKey } from './systemsRecord.js';
export { GraphReadTally, noteGraphReads, takeGraphReads } from './graphReads.js';
export { ManifestBuffer, bufferedManifest } from './manifestBuffer.js';
export { LOCK_REFRESH_MS, LOCK_STALE_MS, acquireReplicaLock, fileReplicaLock, lockFileName, } from './replicaLock.js';
export { BACKGROUND_TRANSIENT_STREAK, MIN_SEND_INTERVAL_MS, createReplicaHost, } from './replicaHost.js';
//# sourceMappingURL=index.js.map