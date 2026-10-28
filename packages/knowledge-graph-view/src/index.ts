/**
 * `@builderforce/knowledge-graph-view` — the ONE knowledge-graph view (PRD 38 §4.6).
 * Source-only React, so Rovr can import it; pack-agnostic and host-agnostic.
 */

export { KnowledgeGraphView, type KnowledgeGraphViewProps } from './KnowledgeGraphView';
export {
    DEFAULT_KNOWLEDGE_GRAPH_LABELS, resolveLabels, fillTemplate, camelKind,
    type KnowledgeGraphLabels, type FindingKindLabels,
} from './labels';
export { LENSES, LENS_ORDER, lensesFor, lensApplies, lensFindings, type LensDef } from './lenses';
export { findingRequest, findingTitle } from './findingText';
export { layout3d, planeOrder, type Layout3D, type LayoutOptions } from './scene/layout3d';
export { KG_TOKENS, cssVar, readThemeColors, useThemeColors, type ThemeTone, type ThemeColors } from './scene/themeColors';
export type {
    KnowledgeGraphSource, KnowledgeReviewEvent, KnowledgeScopeSummary, KnowledgeSearchHit, ReviewControl,
    ReviewEstimate, ReviewRequest, ReviewTarget, FactActions, LensId, KnowledgePanelRenderer,
    KnowledgePanelRenderProps, KnowledgeConfirm, KnowledgeBaseline, KnowledgeSnapshot, EvidenceSide,
    SourceLocation, FindingEvidence,
} from './types';
