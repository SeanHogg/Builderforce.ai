/**
 * Type definitions for test fixtures.
 * Shared across payload, display, and reasoning modules.
 */

// =============================================================================
// ProgressPayload Type
// =============================================================================

export interface ProgressPayload {
  basis: 'basis' | 'subtasks';
  subtasksDone: number;
  subtasksTotal: number;
  timestamp: string;
  message?: string | null;
  taskId?: string | null;
}

// =============================================================================
// UserInput Type
// =============================================================================

export interface UserInput {
  basis: string;
  subtasksDone: number;
  subtasksTotal: number;
  message?: string;
}

// =============================================================================
// ReasoningOutput Type
// =============================================================================

export interface ReasoningOutput {
  conclusion: string;
  confidenceScore: number;
  steps: string[];
  conflictSignals?: string[];
}

// =============================================================================
// MockReasoningConfig Type
// =============================================================================

export interface MockReasoningConfig {
  seed?: number;
  deterministic: boolean;
}

// =============================================================================
// DisplayFormatter Type
// =============================================================================

export type DisplayFormatter = (payload: ProgressPayload, reasoning: ReasoningOutput) => string;