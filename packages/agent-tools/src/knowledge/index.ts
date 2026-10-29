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
    KNOWLEDGE_REVIEW_MODEL_CALLS, analysisManifestKey, analysisSha, buildStoredGraph, indexedSymbolSource,
    planKnowledgeReview, planKnowledgeReviewDetail, reviewPacks, runKnowledgeReview, workspaceCodeAnalyzers,
    type KnowledgeReviewOptions, type KnowledgeReviewPorts, type StoredGraphArgs, type WorkspaceAnalyzersDeps,
} from './reviewRunner.js';
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
    type FsDirectorySourceOptions, type HashCache, type KnowledgeFs,
} from './fsDirectorySource.js';
export { fileManifest, manifestFileName, migratingRootFiles, snapshotFileName, type KnowledgeFiles } from './fileManifest.js';
export { folderIdOf, repoIdOfRemote, rootIdFor, rootIdOfSourceRef, rootRelOf, sourcePathOf, type RootIdParts } from './rootId.js';
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
