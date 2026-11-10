/**
 * Portable analyzer artifacts consumed by every audit surface. No filesystem or UI dependencies.
 *
 * The snapshot types, `normalizeAnalysis` and `compareAnalysis` live in memory `/knowledge`
 * (`comparability.ts`, PRD 41 §C3/§C9): ONE identity and ONE comparability rule set for the web
 * analysis compare and the knowledge compare. This module keeps the import path every consumer
 * uses and adds the one field memory's snapshot does not carry yet: `truncated` (L3 cap, PRD 41 B2).
 */
import {
  analysisMeta, comparable, compareAnalysis as compareMeasured,
  type CodeAnalysisSnapshot as MeasuredSnapshot, type ComparabilityMeta,
} from '@seanhogg/builderforce-memory/knowledge';

export { normalizeAnalysis } from '@seanhogg/builderforce-memory/knowledge';
export type { AnalysisIssue, AnalysisLocation } from '@seanhogg/builderforce-memory/knowledge';

export interface CodeAnalysisSnapshot extends MeasuredSnapshot {
  /** Set when the analyzed scope held more files than the L3 cap (`MAX_LISTED_FILES`), or its listing was cut short: the analysis is partial and not comparable (PRD 41 B2, C9). */
  truncated?: true;
}
export interface CodeAnalysisComparison { current: CodeAnalysisSnapshot; baseline?: CodeAnalysisSnapshot }

/** Memory's {@link analysisMeta} plus the snapshot's `truncated` flag, so a partial side reaches `comparable()` as `truncated`. */
export function codeAnalysisMeta(snapshot: CodeAnalysisSnapshot): ComparabilityMeta {
  return { ...analysisMeta(snapshot), ...(snapshot.truncated ? { truncated: true } : {}) };
}

/**
 * Memory's `compareAnalysis`, gated also by {@link codeAnalysisMeta}: a truncated side (either one) is not
 * comparable, so it reports nothing `added` or `resolved` — an issue missing from a partial scan is never a fix.
 */
export function compareAnalysis(current: CodeAnalysisSnapshot, baseline?: CodeAnalysisSnapshot): ReturnType<typeof compareMeasured> {
  const measured = compareMeasured(current, baseline);
  if (!baseline) return measured;
  const extra = comparable(codeAnalysisMeta(baseline), codeAnalysisMeta(current)).reasons;
  if (extra.every((reason) => measured.reasons.includes(reason))) return measured;
  const reasons = [...new Set([...measured.reasons, ...extra])].sort();
  return { ...measured, comparable: false, reasons, added: [], resolved: [] };
}
