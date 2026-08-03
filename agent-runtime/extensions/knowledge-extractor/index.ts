/**
 * Knowledge Extractor — Delta Detection Engine
 * 
 * Post-execution module that detects, structures, and persists learning
 * deltas from agent execution cycles across three detection modes.
 * 
 * @package @builderforce/knowledge-extractor
 * @version 2026.3.21
 */

// Re-export all public APIs from src/
export {
  runExtraction,
  runExtractionWithBudget,
} from "./src/index.js";

export type {
  SignalType,
  ChangeType,
  LearningStatus,
  DivergenceClass,
  ExtractionWarning,
  TraceAction,
  AnticipatedAction,
  RunContext,
  LearningSignal,
  KnowledgeSnapshot,
  LearningRecord,
  ModeCounts,
  StatusCounts,
  ExtractionReport,
  ExtractorConfig,
  DiffType,
  KnowledgeDiff,
  QuarantineEntry,
  ConflictEntry,
  ExtractionEvent,
  AuditLogEntry,
} from "./src/types.js";

export {
  DEFAULT_EXTRACTOR_CONFIG,
  globalWeights,
} from "./src/types.js";

export {
  extractExplicit,
} from "./src/explicit.js";

export {
  extractImplicit,
  diffSnapshots,
} from "./src/implicit.js";

export {
  extractBehavioral,
} from "./src/behavioral.js";

export {
  calculateConfidence,
  evaluateRecord,
  computeSignalWeight,
  computeBranchWeight,
} from "./src/confidence.js";

export {
  createLearningId,
  getExtractorVersion,
  nowISO,
  computeDistribution,
  EXTRACTOR_VERSION,
} from "./src/utils.js";
