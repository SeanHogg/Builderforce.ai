/**
 * Project Health Baseline Types
 *
 * Core domain models for baseline creation, versioning, comparison,
 * and lifecycle management. Framework-agnostic TypeScript interfaces.
 *
 * @see PRD #294 — Responses Saved as Project Health Baseline
 */

/** Baseline lifecycle status */
export type BaselineStatus = 'active' | 'archived';

/** Baseline status metadata */
export const BASELINE_STATUS_LABELS: Record<BaselineStatus, string> = {
  active: 'Active',
  archived: 'Archived',
};

/** Version number — monotonically incrementing integer scoped to (projectId, streamName) */
export type VersionNumber = number;

/** Lifecycle actions recorded in the audit trail */
export type AuditAction = 'CREATE' | 'PROMOTE' | 'ARCHIVE' | 'VIEW' | 'COMPARE';

/** Metadata attached to the original AI response that was saved */
export interface ResponseMetadata {
  /** LLM model that generated the response (e.g. 'builderforce-llm-gpt-4') */
  model: string;
  /** ISO 8601 timestamp when the response was generated */
  timestamp?: string;
  /** Context mode (e.g. 'code-review', 'test-coverage-analysis') */
  contextMode?: string;
  /** Free-form project context at time of capture */
  projectContext?: string;
  /** Extensible metadata */
  [key: string]: unknown;
}

/** User-visible metadata describing a baseline */
export interface BaselineMetadata {
  /** Project ID (integer key per platform convention) */
  projectId: number;
  /** Stream name (e.g. 'performance-baseline', 'security-baseline') */
  baselineName: string;
  /** Optional human-readable description */
  description?: string;
  /** Tags for filtering (e.g. ['security', 'refactor', 'v2-migration']) */
  tags: string[];
}

/** The AI response content that was captured */
export interface BaselineContent {
  /** Full response text (UTF-8, preserved as-is) */
  responseText: string;
  /** Original response metadata */
  responseMetadata: ResponseMetadata;
}

/** Author who created this baseline */
export interface BaselineAuthor {
  /** Platform user identifier */
  userId: string;
  /** Display name */
  name: string;
}

/** A single audit log entry for a baseline lifecycle event */
export interface BaselineAuditEntry {
  /** Unique audit entry ID (UUID v4) */
  id: string;
  /** Lifecycle action */
  action: AuditAction;
  /** Who performed the action (userId) */
  performedBy: string;
  /** ISO 8601 timestamp of the action */
  timestamp: string;
  /** Optional additional details (diff stats, old status, etc.) */
  details?: unknown;
}

/** Immutable baseline entity. Once created, `content` and `author` never change. */
export interface Baseline {
  /** Primary key (integer per platform convention) */
  id: number;
  /** Stream version — monotonically incrementing per (projectId, streamName) */
  version: VersionNumber;
  /** Lifecycle status */
  status: BaselineStatus;
  /** User-visible metadata */
  metadata: BaselineMetadata;
  /** Immutable captured response content */
  content: BaselineContent;
  /** Immutable author info */
  author: BaselineAuthor;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp (status changes only) */
  updatedAt: string;
  /** Append-only audit trail */
  auditTrail: BaselineAuditEntry[];
}

/** Input for creating a new baseline */
export interface CreateBaselineInput {
  /** Project ID */
  projectId: number;
  /** Stream name (e.g. 'performance-baseline') */
  baselineName: string;
  /** Optional description */
  description?: string;
  /** Tags for filtering */
  tags?: string[];
  /** Full response text to capture */
  responseText: string;
  /** Response metadata */
  responseMetadata: ResponseMetadata;
  /** Author info */
  author: BaselineAuthor;
}

/** Input for updating baseline metadata (status changes only via promote/archive) */
export interface UpdateBaselineInput {
  status?: BaselineStatus;
  description?: string;
  tags?: string[];
}

/** Filter parameters for listing baselines */
export interface BaselineFilter {
  projectId: number;
  status?: BaselineStatus;
  tags?: string[];
  name?: string;
  dateFrom?: string;
  dateTo?: string;
  author?: string;
  limit?: number;
  offset?: number;
}

/** Paginated baseline list response */
export interface BaselineListResponse {
  baselines: Baseline[];
  total: number;
  returned: number;
  truncated: boolean;
}

/** A single diff block between two baseline response texts */
export interface DiffBlock {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  position: {
    startLine: number;
    endLine: number;
  };
}

/** Result of a baseline comparison */
export interface BaselineDiffResult {
  baseline1: {
    id: number;
    baselineName: string;
    version: VersionNumber;
    content: BaselineContent;
  };
  baseline2: {
    id: number;
    baselineName: string;
    version: VersionNumber;
    content: BaselineContent;
  };
  diff: DiffBlock[];
  healthDeltaSummary: {
    summary: string;
    summaryType: 'positive' | 'neutral' | 'negative';
  };
}

/** Result of a promote action */
export interface PromoteResult {
  message: string;
  newBaseline: Baseline;
  previouslyActive: {
    id: number;
    version: VersionNumber;
    status: BaselineStatus;
  } | null;
}

/** Standard API error shape */
export interface ApiError {
  error: string;
  code: string;
  status: number;
  details?: unknown;
}

/** Role-based access control levels */
export type BaselineRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** Actions that can be performed on baselines */
export type BaselineAction = 'create' | 'view' | 'compare' | 'promote' | 'archive' | 'delete' | 'list';