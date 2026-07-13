/**
 * List components — shared list view utilities.
 *
 * Remix progress breakdown and scanable list patterns across insights, PMO, and board surfaces.
 *
 * Architecture traceability:
 * - Design & acceptance criteria: For this feature, ref PRD.md (Compact List Progress Breakdown, task #667).
 * - Component contract: ref CompactListProgress.tsx (ProgressItem, CompactListProgress, helpers).
 * - Example integration: EvermindBrainMap.tsx (DemoRegionProgress usage).
 * - Integration rationale: FR-8 (reusability across any domain); EvermindBrainMap demonstrates scoped integration without modifying data layers.
 */

export { CompactListProgress } from './CompactListProgress';
export type { ProgressItem, PList, SortBy, ValueFormat } from './CompactListProgress';
export { formatPct, formatValue, toPercent } from './CompactListProgress';
export {
  STATUS_VALUES,
  STATUS_LABELS,
  STATUS_ICONS,
  getColorByStatus,
} from './CompactListProgress';