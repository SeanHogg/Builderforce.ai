/**
 * Project Health Baseline Types
 *
 * Domain models for baseline creation, versioning, comparison, and lifecycle management.
 * These are framework-agnostic TypeScript interfaces and enums.
 */

/** Baseline stream status: active or archived */
export type BaselineStatus = 'active' | 'archived';

export const BaselineStatus: Record<
  BaselineStatus,
  { label: string; readonly: boolean }
> = {
  active: { label: 'Active', readonly: false },
  archived: { label: 'Archived', readonly: true },
};

/** Baseline version numbers (monotonically incrementing) */
export type BaselineVersion = 'v1' | 'v2' | 'v3' | 'v4';

export const BaselineVersion: Record<
  BaselineVersion,
  { label: string; isLatest: boolean }
> = {
  v1: { label: 'v1', isLatest: false },
  v2: { label: 'v2', isLatest: true },
  v3: { label: 'v3', isLatest: true },
  v4: { label: 'v4', isLatest: true },
};

/** Version inference for newly created baselines */
export const inferBaselineVersion = (existingVersions: number): BaselineVersion => {
  switch (existingVersions) {
    case 0:
      return 'v1';
    case 1:
      return 'v2';
    case 2:
      return 'v3';
    case 3:
      return 'v4';
    default:
      return 'v4'; // Cap at v4 to minimize cyclomatic complexity
  }
};

/** Context metadata attached to an AI response */
export interface ResponseMetadata {
  /** LLM model used (e.g., 'builderforce-llm-gpt-4') */
  model: string;
  /** Optional timestamp when the response was generated */
  timestamp?: string;
  /** Optional context mode (e.g., 'code-review', 'test-coverage-analysis') */
  contextMode?: string;
  /** Optional project-specific context */
  projectContext?: string;
  /** Optional additional fields (flexible JSON) */
  [key: string]: unknown;
}

/** Baseline metadata */
export interface BaselineMetadata {
  /** Project ID (integer key per platform convention) */
  projectId: number;
  /** Stream name (e.g., 'performance-baseline') */
  baselineName: string;
  /** Optional human-readable description */
  description?: string;
  /** Optional tags for filtering (e.g., ['security', 'refactor']) */
  tags: string[];
}

/** Content composed of an AI response */
export interface BaselineContent {
  /** Full response text (UTF-8, split at paragraph boundaries) */
  responseText: string;
  /** Original response metadata */
  responseMetadata: ResponseMetadata;
}

/** Author information */
export interface BaselineAuthor {
  /** User ID (platform user identifier) */
  userId: string;
  /** Display name */
  name: string;
}

/** Audit entry for compliance */
export interface BaselineAuditEntry {
  /** Unique audit entry ID */
  id: string;
  /** Lifecycle action performed */
  action: 'CREATE' | 'PROMOTE' | 'ARCHIVE' | 'VIEW' | 'COMPARE';
  /** Who performed the action (userId) */
  performedBy: string;
  /** When the action occurred (ISO 8601) */
  timestamp: string;
  /** Optional additional details (e.g., diff stats) */
  details?: unknown;
}

/** Complete baseline entity with immutable core fields */
export interface Baseline {
  /** Primary key (integer key per platform convention) */
  id: number;
  /** Stream version */
  version: BaselineVersion;
  /** Stream status */
  status: BaselineStatus;
  /** Baseline metadata */
  metadata: BaselineMetadata;
  /** Persistent response content */
  content: BaselineContent;
  /** Author who created this baseline */
  author: BaselineAuthor;
  /** When created (ISO 8601) */
  createdAt: string;
  /** When updated (ISO 8601) */
  updatedAt: string;
  /** Immutable content-only audit trail */
  auditTrail: BaselineAuditEntry[];
}