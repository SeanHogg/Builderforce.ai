/**
 * AI Assistance Type Definitions
 *
 * Core types for inline suggestions, auto-fill, gap detection, and feedback
 * mechanisms required by FR-1 through FR-5 of the PRD.
 */

/** Confidence level returned with suggestions and auto-fill proposals */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Severity of a detected gap */
export type GapSeverity = 'blocking' | 'warning' | 'suggestion';

/** User feedback rating for a suggestion */
export type FeedbackRating = 'thumbs-up' | 'thumbs-down';

/** Enablement level configuration constraint */
export type EnablementLevel = 'account' | 'record-type' | 'field';

/** Enablement configuration snapshot for a tenant/recordType/field */
export interface EnablementConfig {
  /** Whether AI is enabled at the account level */
  accountEnabled: boolean;
  /** Per-record-type enablement (null = use account default) */
  recordType: boolean | null;
  /** Per-field enablement (null = use recordType/default) */
  field: Record<string, boolean | null>;
}

/** AI suggestion displayed inline within a field */
export interface InlineSuggestion {
  /** ID uniquely identifying this suggestion instance */
  suggestionId: string;
  /** Text suggestion to display (may render as ghost text or dropdown) */
  suggestion: string;
  /** Confidence in the suggestion */
  confidence: ConfidenceLevel;
  /** Human-readable rationale explaining why this value was suggested */
  rationale: string;
  /** Full field path for UI handling and audit */
  sourceField: string;
}

/** Proposed auto-fill value for an empty field */
export interface AutoFillProposal {
  /** Proposed field value */
  suggestedValue: string;
  /** Confidence in the proposal (tooltip or icon) */
  confidence: ConfidenceLevel;
  /** Human-readable rationale */
  rationale: string;
}

/** Detected gap in a record */
export interface Gap {
  /** Unique identifier for the field */
  fieldId: string;
  /** Human-readable field title */
  fieldTitle: string;
  /** Severity determining UI treatment */
  severity: GapSeverity;
  /** Brief description of what is wrong and why */
  description: string;
  /** Action type for the gap */
  action: 'jump' | 'info' | 'skip';
}

/** User feedback on a suggestion instance */
export interface Feedback {
  /** Rating given by the user */
  rating: FeedbackRating;
  /** Optional timestamp */
  timestamp?: Date;
}

/** Input context for generating inline suggestions */
export interface SuggestionContext {
  /** Current field value */
  currentValue: string;
  /** Record ID */
  recordId: string;
  /** Record type */
  recordType: string;
  /** Parent ID (if any) for contextual anchors */
  parentId?: string;
  /** User ID for historical record retrieval */
  userId?: number;
  /** Key-value pairs of sibling fields */
  siblingFields: Record<string, string>;
}

/**
 * Response with inline suggestions (zero or more)
 * - Order by relevance/confidence ( highest first )
 */
export interface InlineSuggestionsResponse {
  /** Unique runId to correlate this request/response pair */
  runId: string;
  /** 500ms bound notes: suggestions returned with minimal dedup / scoring commits to P95 latency */
  suggestions: InlineSuggestion[];
  /** Milliseconds from start of execution (used later by caller for P95 enforcement) */
  durationMs: number;
}

/**
 * Response with auto-fill proposals for empty fields
 * - Expect at most 5 proposals per invocation to satisfy P95 latency & scoring consistency
 */
export interface AutoFillResponse {
  /** Unique runId */
  runId: string;
  /** Field-to-proposal mapping (ID for UI, label/title) */
  proposals: Record<string, AutoFillProposal>;
  /** Milliseconds from start of execution */
  durationMs: number;
}

/**
 * Response with detected gaps for a record
 * - Gaps surfaced by severity ( blocking → warning → suggestion )
 */
export interface GapDetectionResponse {
  /** Unique runId */
  runId: string;
  /** List of detected gaps (may be empty) */
  gaps: Gap[];
  /** Milliseconds from start of execution */
  durationMs: number;
}

/**
 * Feedback for inline or auto-fill suggestion
 */
export interface SuggestionFeedback {
  /** Unique runId */
  runId: string;
  /** Suggestion ID affected (from InlineSuggestion.suggestionId or AutoFillProposal key) */
  suggestionId: string;
  /** Rating given */
  rating: FeedbackRating;
}

/**
 * Global AI assistance preferences snapshot
 */
export interface Preferences {
  /** Account-level AI assist state (disabled/enabled) */
  accountEnabled: boolean;
  /** Per-record-type assist state (null = use account default) */
  recordType: boolean | null;
  /** Per-field assist states (fieldPaths → null = use recordType/default) */
  field: Record<string, boolean | null>;
}