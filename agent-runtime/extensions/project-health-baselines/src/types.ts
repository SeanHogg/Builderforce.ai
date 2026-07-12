/**
 * Baseline entity model for PRD #294: Project Health Baselines
 */

/** Baseline version identifier (finite set inferred from count) */
export type BaselineVersion = "v1" | "v2" | "v3" | "v4";

/** Baseline status: immutable lifecycle states */
export type BaselineStatus = "active" | "archived";

/** Binary delta block types */
export type DeltaBlockType = "added" | "removed" | "unchanged";

/** Health delta summary narrative type based on directionality */
export type HealthDeltaSummaryType = "positive" | "negative" | "neutral";

/** Denormalized reply metadata as stored on creation for core immutability fields */
export type ResponseMetadataCore = {
  model: string;
  timestamp: string;
  contextMode?: string;
};

/** Full metadata attached to a baseline at creation */
export type BaselineMetadata = {
  projectId: number;
  streamName: string; // e.g., "performance-baseline"
  baselineName: string;
  description?: string;
  tags?: string[];
  responseMetadata: ResponseMetadataCore;
  author: BaselineAuthor;
};

/** Full response content (text response only) */
export type BaselineContent = {
  responseText: string;
  responseMetadata: ResponseMetadataCore;
};

/** Author identity at creation */
export type BaselineAuthor = {
  userId: string;
  userName?: string;
  role: "owner" | "admin" | "editor" | "viewer";
};

/** Tamper-evident audit entry (immutable append-only) */
export type BaselineAuditEntry = {
  id: string;
  action: "CREATE" | "PROMOTE" | "ARCHIVE" | "VIEW" | "COMPARE";
  timestamp: string;
  userId: string;
  details: Record<string, unknown>;
};

/** Full immutable baseline entity */
export type Baseline = {
  id: number;
  version: BaselineVersion;
  status: BaselineStatus;
  metadata: BaselineMetadata;
  content: BaselineContent;
  author: BaselineAuthor;
  createdAt: string; // ISO 8601
  updatedAt: string;
  auditTrail: BaselineAuditEntry[];
};

/** Filter options for listing baselines */
export type BaselineListFilters = {
  projectId: number;
  streamName?: string;
  status?: BaselineStatus | "all";
  tags?: string[];
  name?: string;
  author?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
};

/** Paragraph-level diff block */
export type DeltaDiffBlock = {
  type: DeltaBlockType;
  content: string;
  context?: string;
  startLine: number;
  endLine: number;
};

/** Diff result (paragraph-level) */
export type DiffResult = {
  added: DeltaDiffBlock[];
  removed: DeltaDiffBlock[];
  unchanged: DeltaDiffBlock[];
  summary: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
};

/** Health delta summary (AI-assisted) */
export type HealthDeltaSummary = {
  summary: string;
  summary_type: HealthDeltaSummaryType;
};