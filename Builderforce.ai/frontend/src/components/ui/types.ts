/**
 * Progressive reveal shared types.
 */
export type Stage = 0 | 1 | 2 | 3;
export type PriorityTier = 'critical' | 'secondary' | 'deferred';

// --------------- stream ---------------

export interface ProgressiveRevealStream {
  key: string;
  priority: PriorityTier;
  resolved: boolean;
  data: unknown | null;
  error: Error | null;
  timestamp: number;
  timeoutMs?: number;
  /** FR-4: accumulated chunks for streaming data sources. */
  chunks: unknown[];
  /** Internal: active timeout timer handle. */
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

// --------------- callbacks (FR-8 / AC-10 observability) ---------------

export interface ProgressiveRevealCallbacks {
  onStreamResolve?: (stream: ProgressiveRevealStream) => void;
  onStreamTimeout?: (stream: ProgressiveRevealStream) => void;
  /** Fires every time the composite stage advances (e.g. 0→1, 1→2). */
  onStageTransition?: (from: Stage, to: Stage, timestamp: number) => void;
}

// --------------- context ---------------

export interface ProgressiveRevealContextValue {
  currentStage: Stage;
  lastTransitionAt?: number;
  streams: Map<string, ProgressiveRevealStream>;
  callbacks?: ProgressiveRevealCallbacks;
  register: (key: string, priority: PriorityTier, timeoutMs?: number) => void;
  resolve: (key: string, data: unknown) => void;
  /** FR-4: append a chunk without marking the stream resolved. */
  append: (key: string, chunk: unknown) => void;
  fail: (key: string, error: Error) => void;
  /** Remove a failed stream so it can be re-registered (AC-8). */
  retry: (key: string) => void;
  reset: (key?: string) => void;
  stage1Data: unknown | null;
  stage2Data: unknown | null;
  stage3Data: unknown | null;
  criticalCount: number;
  secondaryCount: number;
  deferredCount: number;
}

// --------------- FR-7 component contract ---------------

export interface ProgressiveRevealProps {
  stage: Stage;
  priority: PriorityTier;
  isLoading: boolean;
  error: Error | null;
  timeoutMs?: number;
  onRetry?: () => void;
}
