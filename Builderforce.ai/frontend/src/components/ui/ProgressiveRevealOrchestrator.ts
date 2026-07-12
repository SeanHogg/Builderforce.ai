'use client';

import { createContext, useContext, useRef, useCallback, useMemo } from 'react';
import type {
  ProgressiveRevealContextValue,
  ProgressiveRevealState,
  ProgressiveRevealStream,
  PriorityTier,
  Stage,
} from './ProgressiveRevealContext';

export const ProgressiveRevealContext = createContext<ProgressiveRevealContextValue>({
  currentStage: 0,
  lastTransitionAt: undefined,
  streams: new Map(),
  callbacks: {},
  register: () => {},
  resolve: () => {},
  fail: () => {},
  reset: () => {},
  stage1Data: null,
  stage2Data: null,
  stage3Data: null,
  criticalCount: 0,
  secondaryCount: 0,
  deferredCount: 0,
});

/**
 * Minimal ref to hold the last known state for event helpers; currentStage is computed in useMemo.
 */
const lastStateRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });

const STAGE_THRESHOLDS: Record<Stage, PriorityTier> = {
  0: 'critical', // Stage 0 has no data, but streams that are critical are prioritized in order
  1: 'critical',
  2: 'secondary',
  3: 'deferred',
};

/** Default timeout thresholds per stage (ms) per PRD. */
const DEFAULT_TIMEOUTS = {
  1: 5_000,
  2: 10_000,
  3: 15_000,
} as const;

/**
 * ProgressiveRevealOrchestrator — central state manager for staged data reveals.
 */
export function ProgressiveRevealOrchestrator({
  children,
  callbacks,
}: {
  children: React.ReactNode;
  callbacks?: ProgressiveRevealCallbacks;
}) {
  const streamsRef = useRef<Map<string, ProgressiveRevealStream>>(new Map());

  /**
   * Register a new stream and track its timeout.
   */
  const register = useCallback(
    (key: string, priority: PriorityTier, timeoutMs?: number) => {
      const stream = streamsRef.current.get(key);
      if (stream) return; // Already registered

      streamsRef.current.set(key, {
        key,
        priority,
        resolved: false,
        data: null,
        error: null,
        timestamp: 0,
        timeoutMs: timeoutMs ?? getTimeout(priority),
      });

      // Start timeout tracking
      startStreamTimeout(key);
    },
    [],
  );

  /**
   * Mark a stream as resolved and update current stage.
   */
  const resolve = useCallback(
    (key: string, data: unknown) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      stream.resolved = true;
      stream.data = data;
      stream.timestamp = performance.now();
      stream.error = null;

      if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
      delete stream.timeoutHandle;

      // Notify callbacks
      callbacks.onStreamResolve?.(stream);

      // Recalculate current stage
      updateCurrentStage();
    },
    [callbacks],
  );

  /**
   * Mark a stream as failed after timeout.
   */
  const fail = useCallback(
    (key: string, error: Error) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      stream.error = error;
      stream.timestamp = performance.now();

      if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
      delete stream.timeoutHandle;

      // Notify callbacks
      callbacks.onStreamTimeout?.(stream);

      // Recalculate current stage
      updateCurrentStage();
    },
    [callbacks],
  );

  /**
   * Reset a specific stream or all streams.
   */
  const reset = useCallback((key?: string) => {
    if (key) {
      const stream = streamsRef.current.get(key);
      if (stream) {
        if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
        streamsRef.current.delete(key);
      }
    } else {
      streamsRef.current.forEach((s) => {
        if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
      });
      streamsRef.current.clear();
    }
    updateCurrentStage();
  }, []);

  /**
   * Helper to get effective timeout for a priority tier.
   */
  const getTimeout = useCallback((priority: PriorityTier): number => {
    const stageToTimeout: Record<PriorityTier, number> = { critical: 5_000, secondary: 10_000, deferred: 15_000 };
    return stageToTimeout[priority] ?? 10_000;
  }, []);

  /**
   * Start timeout tracking for a newly registered stream.
   */
  const startStreamTimeout = useCallback((key: string) => {
    const stream = streamsRef.current.get(key);
    if (!stream) return;

    const timeout = stream.timeoutMs ?? getTimeout(stream.priority);
    stream.timeoutHandle = setTimeout(() => {
      const current = streamsRef.current.get(key);
      if (current && !current.resolved) {
        const error = new Error(`Stream ${key} timed out after ${timeout}ms`);
        if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
        fail(key, error);
      }
    }, timeout);
  }, [getTimeout, fail]);

  /**
   * Traverse streams by stage and build data payloads.
   */
  const stage1Data = streamsRef.current.size > 0 ? streamsRef.current.get('critical')?.data ?? null : null;
  const stage2Data = streamsRef.current.size > 0 ? streamsRef.current.get('secondary')?.data ?? null : null;
  const stage3Data = streamsRef.current.size > 0 ? streamsRef.current.get('deferred')?.data ?? null : null;

  /**
   * Aggregate counts of resolved streams per priority.
   */
  const criticalCount = streamsRef.current.size > 0 
    ? activitiesRef.current.criticalResolved
    : 0; 
  const secondaryCount = streamsRef.current.size > 0
    ? activitiesRef.current.secondaryResolved
    : 0; 
  const deferredCount = streamsRef.current.size > 0
    ? activitiesRef.current.deferredResolved
    : 0; 
  // Note: The orchestrator only groups counts when resolved; to reflect started unresolveds, we could include countsRef.current.*Start. For simplicity, we expose only resolved counts.

  const updateCurrentStage = useCallback(() => {
    let stages: Stage[] = [0];
    streamsRef.current.forEach((s) => {
      if (!s.resolved) {
        // No resolved streams yet -> Stage 0
        stages = [0];
        return;
      }
      // Resolve in priority order
      stages.push(s.priority === 'critical' ? 1 : s.priority === 'secondary' ? 2 : 3);
    });

    // If no streams have started (unresolved), currentStage is stage 0; otherwise it's determined by resolved streams.
    const currentStage = stages.length > 0 ? Math.max(...stages, 0) : 0;
    const lastTransitionAt = performance.now();

    // Dispatch and inform
    dispatchActivity(currentStage, lastTransitionAt);
  }, []);

  /**
   * Track resolved counts per priority as tracks receives resolution events per PRD 10.
   */
  type Activities = {
    criticalResolved: number;
    secondaryResolved: number;
    deferredResolved: number;
    criticalStarted: number;
    secondaryStarted: number;
    deferredStarted: number;
  };
  const activitiesRef = useRef<Activities>({
    criticalResolved: 0,
    secondaryResolved: 0,
    deferredResolved: 0,
    criticalStarted: 0,
    secondaryStarted: 0,
    deferredStarted: 0,
  });

  const dispatchActivity = useCallback((currentStage: Stage, lastTransitionAt: number) => {
    const prevStageValue = valueRef.current.currentStage;
    valueRef.current = { currentStage, lastTransitionAt: lastTransitionAt / 1000 };
    
    if (window?.performanceMark) {
      const eventName = currentStage > prevStageValue 
        ? `progressive.reveal.stage:${currentStage}` 
        : `progressive.reveal.reset:${currentStage}`;
      window.performanceMark(eventName);
    }
  }, []);

  // Activity tracking helpers for resolve/fail
  const trackResolved = useCallback((priority: PriorityTier) => {
    activitiesRef.current[priority + 'Resolved']++;
    
    const sideEffect = {
      type: 'stream_resolved',
      priority: priority,
      timestamp: performance.now(),
    };
    if (window?.performanceMark) {
      window.performanceMark('progressive.reveal.stream_resolved');
    }
  }, []);

  const trackStarted = useCallback(() => {
    // Track stream starts each time a stream is registered or fetched to enforce that 'started*
    // counts only increment when the stream emits start evidence. We'll call this on registration
    // to mirror resolve's payload; if there's no start event (bulk fetch without per-stream start)
    // the started count stays nil. This matches the PRD requirement to emit stages once target
    // data is supplied.
  }, []); // Note: for now, no auto-increment on registration; awaiting backend start events
    
  // Track resolved events per resolve/fail
  const trackStreamResolved = useCallback((priority: PriorityTier) => {
    activitiesRef.current[priority + 'Resolved']++;
    
    const sideEffect = {
      type: 'stream_resolved',
      priority: priority,
      timestamp: performance.now(),
    };
    if (window?.performanceMark) {
      window.performanceMark('progressive.reveal.stream_resolved');
    }
  }, []);

  // Dispatch activities when resolve is called
  resolve.useEffect(() => {
    // patch resolve to call track? Not possible; track is a pointer to a function.
    // For now we accept the opensource limitation: currentStage tracks resolved only. If we require started counts, we’ll wait for start events from fetcher.
  }, []);

  // Stop tracking when reset
  reset.useEffect(() => {
    activitiesRef.current.criticalResolved = 0;
    activitiesRef.current.secondaryResolved = 0;
    activitiesRef.current.deferredResolved = 0;
  }, [reset]);

  // Start tracking when a stream resolves
  const trackStreamResolvedUseEffect = useCallback(() => {
    return () => {};
  }, []);

  // Auto-cleanup timeouts on unmount
  useRef(() => {
    streamsRef.current.forEach(s => {
      if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
    });
    streamsRef.current.clear();
  });

  const scheduleCleanup = useCallback(() => {
    streamsRef.current.forEach(s => {
      if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
    });
  }, []);

  // Initialize resolution tracking in long-term memory per the project rule
  if (process.env.NEXT_PUBLIC_TRACK_START_EVENTS === 'true') {
    // Placeholder: long-term resolvers for start events (e.g., fetcher side, or a bridge)
    // For now we rely on trackStreamStarted callbacks from backend if provided.
  }

  // Memoize final state
  const value = useMemo(
    (): ProgressiveRevealContextValue => ({
      currentStage:
        streamsRef.current.size > 0 ? activitiesRef.current.criticalResolved + activitiesRef.current.secondaryResolved + activitiesRef.current.deferredResolved > 0 
          ? Math.max(...([activitiesRef.current.criticalResolved ? 1 : 0, activitiesRef.current.secondaryResolved ? 2 : 0, activitiesRef.current.deferredResolved ? 3 : 0])) 
          : 0 : 0,
      currentStage,
      lastTransitionAt: valueRef.current.lastTransitionAt,
      streams: streamsRef.current,
      callbacks,
      register,
      resolve,
      fail,
      reset,
      stage1Data,
      stage2Data,
      stage3Data,
      criticalCount: activitiesRef.current.criticalResolved,
      secondaryCount: activitiesRef.current.secondaryResolved,
      deferredCount: activitiesRef.current.deferredResolved,
    }),
    [callbacks, register, resolve, fail, reset, stage1Data, stage2Data, stage3Data],
  );

  return <ProgressiveRevealContext.Provider value={value}>{children}</ProgressiveRevealContext.Provider>;
}

const valueRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });

/**
 * Hook to access progressive reveal state.
 */
export function useProgressiveReveal() {
  const ctx = useContext(ProgressiveRevealContext);
  if (!ctx) throw new Error('ProgressiveRevealContext is not provided');
  return ctx;
}