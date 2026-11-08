/**
 * `@builderforce/agent-tools/knowledge` — the code pack for memory's knowledge graph
 * (PRD 38 §4.4–4.5, `docs/specs/38-prd-knowledge-graph.md`). Memory
 * (`@seanhogg/builderforce-memory/knowledge`) owns the graph; this supplies what code means.
 *
 * Pure and Worker-safe: the API builds graphs from uploaded snapshots with
 * {@link repoGraphToExtracted} and {@link analysisToExtracted}. The analyzers themselves run
 * through a surface's shell capability, injected by the host.
 */

export {
    CODE_LAYERS, CODE_PARTITIONS_FILE, codeParser, createCodePack, isCodePath, loadCodePartitions,
    type CodePackDeps, type SymbolSource,
} from './codePack.js';
export { knowledgePacks } from './knowledgePacks.js';
export { analysisToExtracted, repoGraphToExtracted, type SerializedRepoGraphShape } from './codeExtracted.js';
export { codeAnalyzers, runCodeAnalysis, type CodeAnalysisRun, type CodeAnalyzersDeps } from './codeAnalyzers.js';
export { CODE_FINDING_RULES, unusedCodeRule } from './codeFindings.js';
export { CODE_BADGES, CODE_PACK_ID, ROOT_OUTPUT_HASH_PREFIX, codeFileNode } from './codeNodes.js';
export {
    LAYER_RULE_PREFIX, toDependencyCruiserRules,
    type DependencyCruiserPathMatch, type DependencyCruiserRule,
} from './dependencyCruiserRules.js';
export {
    KNOWLEDGE_REVIEW_MODEL_CALLS, analysisManifestKey, analysisSha, buildStoredGraph,
    planKnowledgeReview, planKnowledgeReviewDetail, reviewIndexPort, reviewPacks, runKnowledgeReview, workspaceCodeAnalyzers,
    type KnowledgeReviewOptions, type KnowledgeReviewPorts, type ReviewIndexPort, type StoredGraphArgs, type WorkspaceAnalyzersDeps,
} from './reviewRunner.js';
export { indexedSymbolLookup, indexedSymbolSource, type SymbolLookup } from './indexedSymbols.js';
export { planDetailLine, reviewReportText } from './reviewText.js';
export {
    LOCAL_COST_TEXT, reviewCostOf, reviewCostSuffix, type ReviewCallPrice, type ReviewCallPricePort, type ReviewCost,
} from './reviewCost.js';
export {
    KNOWLEDGE_COMPARE_SYSTEM, KNOWLEDGE_EXTRACT_SYSTEM, MAX_JUDGE_TEXT, completionJudgement, fallbackJudgement, judgeWith, replyJson,
    type JudgeCompletion,
} from './judgement.js';
export { HUMAN_FACT_SOURCE, humanFactBatch, humanFactKey } from './humanFact.js';
export {
    KNOWLEDGE_SKIP_DIRS, MAX_LISTED_FILES, createFsDirectorySource, isBuilderforceState, isSkippedPath, listsFile, normalizePath, textDocument,
    type FsDirectorySource, type FsDirectorySourceOptions, type HashCache, type KnowledgeFs,
} from './fsDirectorySource.js';
export { extractDocumentText, withDocumentHashes, withDocumentText } from './documents/index.js';
export { extractedLogFileName, manifestFileName, migratingRootFiles, analysisPendingFileName, dirtyFileName, replicaFileName, runFileName, runsIndexFileName, snapshotFileName, type KnowledgeFiles } from './fileManifest.js';
export {
    createReplicaQueue, memoryReplicaPersistence, relationKey, factKey, fileKey,
    type DirtySnapshot, type ReplicaAck, type ReplicaAnalysis, type ReplicaPersistence, type ReplicaQueue, type ReplicaQueueOptions,
} from './replicaQueue.js';
export { replicatedKnowledgeStore, type ReadThrough, type ReplicaTarget, type ReplicatedStoreArgs } from './replicatedStore.js';
export { GENERATION_CHECK_INTERVAL_MS, emptyReplicaState, pumpReplica, type PumpArgs, type ReplicaClient, type ReplicaFailure, type ReplicaPackStats, type ReplicaState } from './replicaPump.js';
export { buildPack, pathOfRef, DIFF_MAX_FILES, type BuiltPack, type ReplicaSource, type SkippedRow } from './replicaPack.js';
export { hasControlChar, isCleanKey, isCleanText, isWellFormedString } from './packKeyGuard.js';
export { planReconcile, type ReconcilePlan } from './replicaReconcile.js';
export { currentSourcesOf, enqueueFirstSync, enqueueSources, type FirstSyncCounts } from './replicaFirstSync.js';
export { PACK_ROOT_HOST, folderIdOf, isPackRootId, isWellFormedPackRootId, packRootIdFor, repoIdOfRemote, rootIdFor, rootIdOfSourceRef, rootRelOf, sourcePathOf, splitSourceRef, type RootIdParts } from './rootId.js';
export {
    canDeleteFact, factRightsCache,
    type FactAuthor, type FactRightsCache, type FactViewer, type FactsListing,
} from './factRights.js';
export { createShaCache, type ShaCache, type ShaCacheOptions } from './shaCache.js';
export {
    FINGERPRINT_TTL_MS, GIT, fingerprintSha, forgetWorkspaceFingerprints, gitText, workspaceFingerprint,
    type GitCtx, type WorkspaceFingerprint,
} from './workspaceFingerprint.js';
export { folderPrefix, repoGraphUnder, snapshotUnder, underFolder } from './rootRelative.js';
export { forgetRootPorts, rootManifest, rootPorts, rootStore, type RootPorts } from './rootPorts.js';
export {
    analyseWorkspace, forgetWorkspaceAnalyses, readRepoGraph, workspaceAnalysisKey,
    type RepoGraphPort, type WorkspaceAnalysis, type WorkspaceAnalysisDeps,
} from './workspaceAnalysis.js';
export {
    EDIT_DEBOUNCE_MS, currentFileHashes, editedManifestKey, knownKeysCache, markFileEdited, markFilesEdited, pruneEditedFiles, watchFileEdits,
    type FileEditPorts, type KnownKeysCache, type FileEditResult, type WatchFileEditsArgs,
} from './fileEdits.js';
export { claimSimilarity, type SimilarIndex } from './claimSimilarity.js';
export { provenanceLine, type PackProvenanceParts, type ProvenanceLine } from './packProvenance.js';
export {
    mergePacks, packFromSnapshot, parsePack, rebasePackRoot, serializePack,
    type PackFromSnapshotArgs, type PackProvenance, type PackSnapshot, type PortableKnowledgePack,
} from './portablePack.js';
export { mergePacksWithCards, packFromStore, packGraph, reviewHasWork, type PackFromStoreArgs, type PackGraphQuery } from './packGraph.js';
export { buildCodeGraph } from './codeGraph.js';
export { LAYER_IDS, isDefaultLayers, type LayerId, type LayerRule } from './codeLayers.js';
export { coverageSourceState, type CoverageRoot, type CoverageSkip, type CoverageSourceState } from './codeCoverage.js';
export { CHURN_DAYS, type HistoryPort } from './historyPort.js';
export { isSkippedDirName, isVcsMetadataName, type SkippedFolder, type SkippedFolderReason } from '../skipDirs.js';
export { CODEOWNERS_LOCATIONS } from './codeOwners.js';
export { blobDataUrl } from './blobDataUrl.js';
export { gatewayErrorMessage } from './gatewayError.js';
export {
    createReviewRecorder, graphCounts, repoGraphEdgeCount, reviewRecordStore,
    type GraphCounts, type RecordPersistence, type ReviewRecord, type ReviewRecorder, type ReviewRecordStore, type SkippedEntry,
} from './reviewRecord.js';
export {
    MAX_PINPOINT_IMAGE_BYTES, MAX_PINPOINT_MATCHES, MAX_PINPOINT_TEXTS, PINPOINT_VISION_MAX_TOKENS, PINPOINT_VISION_SYSTEM,
    checkPinpointDataUrl, checkPinpointImage, cleanTexts, isCatalogPath, keysOfValue, matchAnchors, parseVisionReply, pinpointVisionRequest,
    type PinpointHit, type PinpointMatch, type PinpointMatchResult, type PinpointPorts, type PinpointProvenance, type VisionContentPart,
} from './pinpointMatch.js';
export {
    COPY_SAMPLE, COPY_SIMILARITY, detectSystems, duplicateCopies, manifestProjectName,
    type CopyReason, type DetectedApp, type DetectedSystem, type DetectedSystems, type DuplicateCopy, type ReadManifest, type SystemsListing,
} from './systems.js';
export { graphSystems, readSystems, recordSystems, systemsManifestKey } from './systemsRecord.js';
export { GraphReadTally, noteGraphReads, takeGraphReads, type GraphFileReads, type GraphSkipReason } from './graphReads.js';
export { ManifestBuffer, bufferedManifest, type ManifestSink, type PendingManifest } from './manifestBuffer.js';
export {
    LOCK_REFRESH_MS, LOCK_STALE_MS, acquireReplicaLock, fileReplicaLock, lockFileName,
    type ReplicaLock, type ReplicaLockPort,
} from './replicaLock.js';
export {
    BACKGROUND_TRANSIENT_STREAK, MIN_SEND_INTERVAL_MS, createReplicaHost,
    type PumpSource, type ReplicaHost, type ReplicaHostOptions, type UploadMarks,
} from './replicaHost.js';
export { type ReplicaHostClient, type SeedPort } from './replicaHostParts.js';
export { additivePlan } from './replicaReconcile.js';
