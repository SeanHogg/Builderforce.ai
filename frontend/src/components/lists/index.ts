/**
 * Barrel for reusable, domain-agnostic list presentation components (FR-8), so a
 * consuming view imports from `@/components/lists` rather than reaching at a file path.
 */
export {
  CompactListProgress,
  sortItems,
  toPercent,
  formatPct,
  formatValue,
  getColorByStatus,
  STATUS_LABELS,
  STATUS_ICONS,
  STATUS_VALUES,
  type ProgressItem,
  type PList,
  type SortBy,
  type ValueFormat,
} from './CompactListProgress';
