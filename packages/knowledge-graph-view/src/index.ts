/**
 * `@builderforce/knowledge-graph-view` — the ONE knowledge-graph view (PRD 38 §4.6).
 * Source-only React, so Rovr can import it; pack-agnostic and host-agnostic.
 */

export { KnowledgeGraphView, type KnowledgeGraphViewProps } from './KnowledgeGraphView';
export {
    DEFAULT_KNOWLEDGE_GRAPH_LABELS, resolveLabels, fillTemplate, camelKind,
    type KnowledgeGraphLabels, type FindingKindLabels, type SurfaceLabels, type StringLabelKey,
} from './labels';
export { labelsFromCatalog } from './catalogLabels';
export * from './delta';
export * from './delta/history';
export { setWorkerFactory } from './compute/sharedClient';
export { buildStations, changedRefs, type Station, type StationModel } from './surface/stations';
export { buildLines, type Line, type LinesModel } from './surface/lines';
export { makeOverlay, PRESETS, METRICS, CHANNELS, type Bindings, type OverlayModel } from './surface/overlays';
export { QUESTIONS, type QuestionId } from './surface/questions';
export type { CameraDef, PanelDef, SceneProps, PanelProps, SurfaceEnv } from './surface/registry';
export { LENSES, LENS_ORDER, lensesFor, lensApplies, lensFindings, type LensDef } from './lenses';
export { ReviewFailure, type ReviewFailureDetail } from './reviewFailure';
export { ABORT_GRACE_MS, STUCK_AFTER_MS } from './reviewTimings';
export { FIX_CHECK_IDS, HOST_CHECK_IDS, FixStepError, type FixCheckId, type FixCheckResult, type FixCheckUpdate, type FixCheckStatus, type FixPreview, type FixStepRequest, type AppliedFix, type RecordedRun, type RecordedValue } from './fixPorts';
export { findingDetail, findingRequest, findingBatchRequest, findingTitle } from './findingText';
export { edgeKindLabel, kindLabel, packLabel } from './names';
export { layout3d, planeOrder, type Layout3D, type LayoutOptions } from './scene/layout3d';
export { KG_TOKENS, cssVar, readThemeColors, useThemeColors, type ThemeTone, type ThemeColors } from './scene/themeColors';
export type {
    KnowledgeGraphSource, KnowledgeReviewEvent, KnowledgeScopeSummary, KnowledgeSearchHit, ReviewControl,
    ReviewEstimate, ReviewRequest, ReviewTarget, FactActions, LensId, KnowledgePanelRenderer,
    KnowledgePanelRenderProps, KnowledgeConfirm, KnowledgeBaseline, KnowledgeSnapshot, EvidenceSide,
    SourceLocation, FindingEvidence, ViewMode, PinpointResult, SyncStatus, SkippedFile, TryRequest, TryResponse, SymbolRecord,
    SourceRange, SourceText, NotReviewedHere, ReplicaState, ReviewRunsPort, ReviewRunSummary, StoredReviewRun,
    AgentRunSeverity, AgentRunSummary, AgentRunTurnKind, AgentRunTurn, AgentRunEvidence, AgentRunFinding, AgentRunFile,
    AgentRunReport, AgentRunsPort,
} from './types';
export { isNotReviewedHere } from './types';
export type { LoadTrace, LoadTraceEntry, LoadTraceInFlight } from './loadTraceTypes';
