/**
 * Portable analyzer artifacts consumed by every audit surface. No filesystem or UI dependencies.
 *
 * The snapshot types, `normalizeAnalysis` and `compareAnalysis` live in memory `/knowledge`
 * (`comparability.ts`, PRD 41 §C3/§C9): ONE identity and ONE comparability rule set for the web
 * analysis compare and the knowledge compare. A snapshot's `truncated` flag (L3 cap, PRD 41 B2) is
 * memory's too: a truncated side is not comparable and reports nothing added or resolved. This module
 * keeps the import path every consumer uses.
 */
export {
  normalizeAnalysis, compareAnalysis, analysisMeta as codeAnalysisMeta,
} from '@seanhogg/builderforce-memory/knowledge';
export type {
  AnalysisIssue, AnalysisLocation, CodeAnalysisSnapshot, CodeAnalysisComparison,
} from '@seanhogg/builderforce-memory/knowledge';
