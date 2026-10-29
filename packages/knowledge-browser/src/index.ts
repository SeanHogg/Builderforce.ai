/**
 * `@builderforce/knowledge-browser` — the ONE browser host of the knowledge review
 * (PRD 38 §4.7) and its PrefetchPort, shared by the web app and Rovr. Hosts keep only what is theirs: their
 * authenticated fetch, their own directory kinds (the web's VFS and Cloud Drive), their
 * worker URL, their reporter and their catalog lookup.
 */

export { createKnowledgeSource, type DirectoryProvider, type KnowledgeSourceOptions } from './knowledgeSource';
export { runReview, type RunReviewOptions, type WorkerFactory } from './reviewWorkerClient';
export { runReviewJob, type ReviewJob, type ReviewPorts } from './reviewJob';
export { LIST_ALL, type FromReviewWorker, type ReviewPortName, type ReviewStart, type ToReviewWorker } from './reviewProtocol';
export { openManifest } from './manifestStore';
export { applyLiveOverlay, LIVE_PAIR_FILES } from './liveOverlay';
export { watchDirectory, LIVE_DEBOUNCE_MS, type LiveWatchPorts } from './liveWatch';
export { estimateReview, type CallPricePort } from './reviewEstimate';
export {
  hostRootId, rootKindOf, normalizePath, isSkippedPath, hashesByContent, contentHash, subtleContentHash,
  metadataHash, textDocument, byteLength, byPath, type KnowledgeDegradedReporter,
} from './directorySourceKit';
export { createUploadDirectorySource, pickFolder, uploadDirectoryProvider } from './uploadDirectorySource';
export {
  createFsAccessDirectorySource, fsAccessDirectoryProvider, pickDirectoryHandle, canPickDirectory, FS_WALK_LIMITS,
  type FsDirectoryHandleLike, type FsFileHandleLike, type FsFileLike,
} from './fsAccessDirectorySource';
export { knowledgeGraphLabels, catalogReader, KNOWLEDGE_GRAPH_NAMESPACE } from './labels';
export {
  BROWSER_KNOWLEDGE_REGISTRY, BROWSER_PREFETCH_CALIBRATION_KEY, createBrowserKnowledgePrefetchPort, knowledgeChipIntent,
  localStorageCalibration, newestReviewedRoot,
  type BrowserKnowledgePrefetchOptions, type CalibrationStore, type KnowledgeChipIntent,
} from './prefetchPort';
