/**
 * Work-item status per task-tracking (Task 250):
 * FR-1: Item Data Model — the five tracked fields are stored via the backend
 * endpoint /api/tracking/:projectId and surfaced via the TrackingListView.
 */
export type TrackedStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'In Review' | 'Complete';

/**
 * FR-1: Item Data Model — risk_level per task-tracking
 */
export type TrackedRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

/**
 * FR-1: Item Data Model — tracked item for list/render
 */
export interface TrackedItem {
  /** The underlying task ID (for PATCH updates on Next Action) */
  taskId: number;
  /** Project-scoped internal key (from tasks.key) */
  key: string;
  title: string;
  /** FR-1 */
  status: TrackedStatus;
  /** FR-1 (0–100 inclusive) */
  completionPct: number;
  /** FR-1 */
  riskLevel: TrackedRiskLevel;
  /** FR-1 (free text) */
  keyBlocker: string | null;
  /** FR-1 (free text; max 500 chars enforced in backend) */
  nextAction: string;
}

/**
 * CSV/market export payload (export takes the current sorted+filtered set)
 */
export interface TrackingExportRow extends Pick<TrackedItem, 'key' | 'title' | 'status' | 'completionPct' | 'riskLevel' | 'keyBlocker' | 'nextAction'> {
  /** Export timestamp (ISO) */
  exportedAt: string;
}

/**
 * Grouping variant (tile/group UI). Empty array = no sorting/grouping applied, rows in input order.
 */
export interface TrackingGroup {
  key: string;
  label: string;
  items: TrackedItem[];
}

/**
 * FR-4: Filtering and Sorting surface
 */
export interface TrackingFilter {
  statusFilters?: Set<TrackedStatus>;
  riskFilters?: Set<TrackedRiskLevel>;
}

export interface TrackingSort {
  /** completion_pct ascending/descending */
  completionPct?: 'asc' | 'desc';
  /** risk_level descending severity (Critical → Medium → Low) */
  riskLevel?: 'desc';
}

/**
 * FR-2: Create/Update payload.
 * next_action is required on create (fails with zero values or missing).
 * completion_pct must be within 0–100 per FR-1.
 */
export interface TrackedItemUpsert {
  nextAction: string;
  completionPct?: number;
}

/**
 * Panorama view variant (framed as a project-level tracking page).
 */
export interface TrackingPageData {
  title: string;
  subtitle?: string;
  /** For multiple groups (filtering by status) */
  groups?: TrackingGroup[];
  /** Flat array when no explicit grouping */
  items?: TrackedItem[];
  /** Applied filter state */
  filter?: TrackingFilter;
  /** Applied sort state */
  sort?: TrackingSort;
}

/**
 * FR-2/3: UI strings — English defaults, overridable so the host can localize (the VS Code webview feeds its `vscode.l10n` bundle; the web app uses next-intl).
 */
export interface TrackingLabels {
  /** Reported by server or fetched from the adapter; the component presents the list. */
  title?: string;
  subtitle?: string;
  refresh: string;
  connecting: string;
  loadError: string;
  empty: string;
  emptyHint: string;
  items: string;
  /** Row-level (field) labels */
  nextActionLabel: string;
  keyBlockerLabel: string;
  riskLevelLabel: string;
  statusLabel: string;
  completionPctLabel: string;
  keyLabel: string;
  titleLabel: string;
  /** Export label */
  exportLabel: string;
  /** Inline edit — text shown next to the Next Action field (optional) */
  editNextActionHint?: string;
  /** Filter chips */
  statusFilterLabel: string;
  riskFilterLabel: string;
  clearFiltersLabel: string;
  riskCritical: string;
  riskHigh: string;
  riskMedium: string;
  riskLow: string;
  statusBlocked: string;
  /** Column headers and toolbar */
  tableHeaders: {
    key: string;
    title: string;
    status: string;
    completionPct: string;
    riskLevel: string;
    keyBlocker: string;
    nextAction: string;
  };
  /** Error states */
  validationNextActionRequired: string;
  validationCompletionPctRange: string;
}

export const DEFAULT_TRACKING_LABELS: TrackingLabels = {
  refresh: 'Refresh',
  connecting: 'Loading…',
  loadError: "Couldn't load this page",
  empty: 'Nothing here yet',
  emptyHint: '',
  items: 'items',
  // Row-level labels
  nextActionLabel: 'Next Action',
  keyBlockerLabel: 'Key Blocker',
  riskLevelLabel: 'Risk',
  statusLabel: 'Status',
  completionPctLabel: 'Progress',
  keyLabel: 'Key',
  titleLabel: 'Title',
  // Export
  exportLabel: 'Export',
  // Inline-edit hint
  editNextActionHint: 'edit…',
  // Filter chips
  statusFilterLabel: 'Status',
  riskFilterLabel: 'Risk',
  clearFiltersLabel: 'Clear All',
  // Risk level labels
  riskCritical: 'Critical',
  riskHigh: 'High',
  riskMedium: 'Medium',
  riskLow: 'Low',
  // Status labels
  statusBlocked: 'Blocked',
  // Headers & toolbar
  tableHeaders: {
    key: 'Key',
    title: 'Title',
    status: 'Status',
    completionPct: 'Progress',
    riskLevel: 'Risk',
    keyBlocker: 'Blocker',
    nextAction: 'Next Action',
  },
  // Validation errors (backend shows inline; kept here for local validity hints)
  validationNextActionRequired: 'Next Action is required',
  validationCompletionPctRange: 'Progress must be between 0 and 100',
};