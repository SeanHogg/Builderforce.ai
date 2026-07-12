/**
 * Progressive reveal shared types.
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
  key: string;
  priority: PriorityTier;
  resolved: boolean;
  data: unknown | null;
  error: Error | null;
  timestamp: number;
  timeoutMs?: number;
  /** Active timeout timer handle (internal to the orchestrator). */
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export interface ProgressiveRevealCallbacks {
  onStreamResolve?: (stream: ProgressiveRevealStream) => void;
  onStreamTimeout?: (stream: ProgressiveRevealStream) => void;
}

export type ProgressiveRevealContextValue = ProgressiveRevealState & {
  streams: Map<string, ProgressiveRevealStream>;
  callbacks: ProgressiveRevealCallbacks;
  register: (key: string, priority: PriorityTier, timeoutMs?: number) => void;
  resolve: (key: string, data: unknown) => void;
  fail: (key: string, error: Error) => void;
  reset: (key?: string) => void;
  stage1Data: unknown | null;
  stage2Data: unknown | null;
  stage3Data: unknown | null;
  criticalCount: number;
  secondaryCount: number;
  deferredCount: number;
};

export type Activities = {
  criticalResolved: number;
  secondaryResolved: number;
  deferredResolved: number;
  criticalStarted: number;
  secondaryStarted: number;
  deferredStarted: number;
};