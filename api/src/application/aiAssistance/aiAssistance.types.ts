/**
 * AI Assistance Type Definitions
 * 
 * Core types for inline suggestions, auto-fill, gap detection, and feedback
 * mechanisms required by FR-1 through FR-5 of the PRD.
 */

/**
 * Confidence level returned with suggestions and auto-fill proposals
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Severity of a detected gap
 */
export type GapSeverity = 'blocking' | 'warning' | 'suggestion';

/**
 * User feedback rating for a suggestion
 */
export type FeedbackRating = 'thumbs-up' | 'thumbs-down';

/**
 * Enablement level configuration constraint
 */
export type EnablementLevel = 'account' | 'record-type' | 'field';

/**
 * An AI suggestion displayed inline within a field
 * FR-1.1, FR-1.2, FR-1.3, FR-4.1
 */
export interface AISuggestion {
  /** ID uniquely identifying this suggestion instance */
  suggestionId: string;
  /** Text suggestion to display (may render as ghost text or dropdown) */
  suggestion: string;
  /** Confidence in the suggestion (guides visibility/explanations) */
  confidence: ConfidenceLevel;
  /** Brief human-readable rationale explaining why this value was suggested */
  rationale: string;
  /** Full field path (e.g. "project.priority") for UI handling and audit */
  sourceField: string;
}

/**
 * A proposed auto-fill value for an empty field
 * FR-2.1, FR-2.4
 */
export interface AutoFillProposal {
  /** Proposed field value (may render in "AI-suggested" state before confirmation) */
  suggestedValue: string;
  /** Confidence in the proposal (tooltip or icon) */
  confidence: ConfidenceLevel;
  /** Human-readable rationale (references similar records if available) */
  rationale: string;
}

/**
 * A detected gap in a record
 * FR-3.1, FR-3.2, FR-3.3
 */
export interface Gap {
  /** Unique identifier for the field */
  fieldId: string;
  /** Human-readable field title (e.g. "Primary Contact Email") */
  fieldTitle: string;
  /** Severity determining UI treatment and order */
  severity: GapSeverity;
  /** Brief description of what is wrong and why */
  description: string;
  /** Action type for the gap (e.g. "jump" to field, "info" for wording, "skip") */
  action: 'jump' | 'info' | 'skip';
}

/**
 * User feedback on a suggestion instance
 * FR-4.1, FR-4.2
 */
export interface Feedback {
  /** Rating given by the user */
  rating: FeedbackRating;
  /** Optional additional comment (max length TBD) */
  comment?: string;
  /** Optional timestamp if outside the current session (future extension) */
  timestamp?: Date;
}

/**
 * Enablement configuration snapshot for a tenant/recordType/field
 * FR-5.1
 */
export interface EnablementConfig {
  /** Whether AI is enabled at the account level */
  accountEnabled: boolean;
  /** Per-record-type enablement (null = use account default) */
  recordType?: null | boolean;
  /** Per-field enablement (null = use recordType/default) */
  field?: Record<string, null | boolean>;
}

/**
 * Chainable builder for constructing inline suggestion queries
 * (simplifies layered prompt construction and invariant sanitization)
 */
export interface InlineSuggestionBuilder {
  fieldPath: string;
  currentValue: string;
  recordId: string;
  recordType: string;
  parentId?: string;
  userId?: number;
  siblingFields?: Record<string, string>;
  maxLengthContext?: number;
  /** 
   * Apply constraint-style heuristics: exact limit (maxLengthContext) and hard match heuristics 
   * (e.g., exact preferred pattern replacement, lexical fix only). If strict match is true, 
   * we only replace exact leading-ports pattern with exact schemes when the content 
   * matches prefix/suffix constraints and expects a single value. This is used to constrain 
   * non-LLM de-dup step, not to guide the LLM (which might exceed tokens or hallucinate). 
   */
  exactMatchEnforcement?: boolean;
}

/**
 * Author-terminology ACT-1 (resolved in this module): Inline suggestion latency bound
 * - PRD says <500ms at p95 under normal load; lexically this can only be met
 *   if suggestion count is small per invocation (<5) and we allow only incremental
 *   risk cases per frame per de-dup/smoothing step
 * - We require per-chunk <5 candidates and capped total candidates across frames
 *   (soft cap due to scoring stability)
 */
export interface InvariantConfig {
  innerChunkCandidateMax: number;
  totalCandidateSoftCap: number;
}

/**
 * AI-assisted tool (suggestion auto-fill, gap detection) explanation control
 */
export interface ToolExplanation {
  /** Render whether suggestions are enabled at this scope */
  suggestionsEnabled: string;
  /** Human-readable reason for enabling/disabling suggestions (field, schema, or policy) */
  reason: string;
  /** Use project_facts KV store to fetch tenant-level mutable config (defaults to repository schema if needed) */
  fetchFromProjectFacts?: boolean;
  /** Store key in project_facts KV store for mutable preferences (RR, UI toggles, etc.) */
  storeKey: string;
}