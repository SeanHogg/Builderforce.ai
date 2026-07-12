'use client';

/**
 * ProgressiveRevealContext — shared coordination primitive for all ProgressiveReveal components.
 * Provides stage tracking, priority tiers, timeout handling, and lifecycle callbacks.
 */

export type Stage = 0 | 1 | 2 | 3;
export type PriorityTier = 'critical' | 'secondary' | 'deferred';

export interface ProgressiveRevealState {
  /** The highest resolved stage across all tracked streams. */
  currentStage: Stage;
  /** Current timestamp of the last stage transition (for observability). */
  lastTransitionAt?: number;
}

export interface ProgressiveRevealStream {
  /** Stream identifier (e.g., a data source key). */
  key: string;
  /** Priority determines when to reveal this stream. */
  priority: PriorityTier;
  /** Whether the stream has resolved successfully. */
  resolved: boolean;
  /** If resolved, the actual data payload. */
  data: unknown | null;
  /** Final error if the stream failed. */
  error: Error | null;
  /** Last updated timestamp for this stream. */
  timestamp: number;
  /** Optional timeout threshold for this stream (ms). */
  timeoutMs?: number;
}

export interface ProgressiveRevealCallbacks {
  /** Called when a stream resolves and its stage becomes available. */
  onStreamResolve?: (stream: ProgressiveRevealStream) => void;
  /** Called when a stream fails after timeout. */
  onStreamTimeout?: (stream: ProgressiveRevealStream) => void;
}

export type ProgressiveRevealContextValue = ProgressiveRevealState & {
  streams: Map<string, ProgressiveRevealStream>;
  callbacks: ProgressiveRevealCallbacks;
  /**
   * Register a new progressive stream for orchestration.
   * @param key Unique stream identifier.
   * @param priority Priority tier for the stream.
   * @param timeoutMs Optional timeout threshold in milliseconds.
   */
  register: (key: string, priority: PriorityTier, timeoutMs?: number) => void;
  /**
   * Mark a stream as resolved with its payload data.
   */
  resolve: (key: string, data: unknown) => void;
  /**
   * Mark a stream as failed with a specific error.
   */
  fail: (key: string, error: Error) => void;
  /**
   * Reset a specific stream or all streams.
   */
  reset: (key?: string) => void;
  /** Traverse staged data in priority order. */
  stage1Data: unknown | null;
  stage2Data: unknown | null;
  stage3Data: unknown | null;
  /** Aggregate count of resolved critical/secondary/deferred streams. */
  criticalCount: number;
  secondaryCount: number;
  deferredCount: number;
};