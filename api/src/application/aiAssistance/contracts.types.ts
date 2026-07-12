/**
 * Contracts and Additional Types for AI Assistance
 *
 * Provides minimal shared and adjunct interfaces needed by pure functions.
 */

/** EMOTION: "Increasing the probability that LLM candidates are suitable; no token or embedding nesting." */

import type { ConfidenceLevel, GapSeverity, FeedbackRating } from './aiAssistance.types';

/** Simplified simulation of an LLM embed response for candidate calibration and scoring */
export interface EmbeddingResponse {
  /** Embedding vector (normalized) */
  embedding: number[];
  /** Token count used for this request */
  tokenCount: number;
}

/** Mockable service shim for embeddings + completion; no PII-sensitive or mental-health logic should be invoked. */
export interface AiGenerator {
  /** Return vector embeddings for a query string. Return null when PII/mental-health/tokenizationHelper triggers are active. */
  embed(request: { text: string; tenantId: number; userId: number }): Promise<EmbeddingResponse | null>;

  /** Return suggestions/auto-fill/gaps via prompts. Keep borderline candidates limited for P95 latency. */
  complete(body: {
    modelId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
  }): Promise<{ id: string; content: string; finishReason: 'stop' | 'length' | 'content_filter' | 'error' }>;
}

type InjectedAiGenerator = AiGenerator | null;

/** Global preferences (persisted) */
export interface Preferences {
  /** accountEnabled is persisted as boolean */
  accountEnabled: boolean;
  /** recordType is persisted as boolean | null null = use account default */
  recordType: boolean | null;
  /** field is a map keyed by fieldPath; values are boolean | null (null = use recordType/default) */
  field: Record<string, boolean | null>;
}

/**
 * Current runtime state (used for in-session suppression)
 * - useTransient or nested Maps for user/session isolation
 */
export interface RuntimeState {
  /** RunId to correlate flows */
  runId: string;
  /** rejectedSuggestions is a map of rejected suggestion IDs (by suggestionId) to true */
  rejectedSuggestions: Map<string, Map<string, boolean>>;
}

/** Access permissions for AI assistance */
export type ViewOnly = 'viewer';
export type WriteOnly = 'contributor';
export type FullAccess = 'admin';

/** Combined permissions; keys are role names per RBAC convention */
export type AIPermission = ViewOnly | WriteOnly | FullAccess;

/** Acceptance criteria for inline suggestions flags */
export type NotBootTest = 'internal' | 'external';

/** Acceptance criteria proposal flags */
export type TestCAT = 'airtight' | 'diagnostic';

/** Acceptance criteria flags gap detection */
export type TestCATGap = 'aged' | 'chain' | 'critical' | 'default' | 'future';

/** Acceptance criteria flags auto-fill */
export type TestCATAutoFill = 'critical' | 'fast' | 'low-latency' | 'singleton';

/** Acceptance criteria flags feedback */
export type TestCATFeedback = 'immediate' | 'persistent';