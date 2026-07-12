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
  const lastStateRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });
  const activitiesRef = useRef<Activities>({
    criticalResolved: 0,
    secondaryResolved: 0,
    deferredResolved: 0,
    criticalStarted: 0,
    secondaryStarted: 0,
    deferredStarted: 0,
  });

  /**
   * Helper to get effective timeout for a priority tier.
   */
  const getTimeout = useCallback(
    (priority: PriorityTier): number => {
      if (priority === 'critical') return 5_000;
      if (priority === 'secondary') return 10_000;
      return 15_000;
    },
    [],
  );

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

      // Track that a stream has started
      activitiesRef.current[priority + 'Started']++;
    },
    [getTimeout, startStreamTimeout],
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

      // Track resolution
      activitiesRef.current[stream.priority + 'Resolved']++;

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
  const reset = useCallback(
    (key?: string) => {
      if (key) {
        const stream = streamsRef.current.get(key);
        if (stream) {
          if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
          // Decrement started count if deregistering
          if (stream.priority) {
            activitiesRef.current[stream.priority + 'Started']--;
          }
          streamsRef.current.delete(key);
        }
      } else {
        streamsRef.current.forEach((s) => {
          if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
          if (s.priority) {
            activitiesRef.current[s.priority + 'Started']--;
          }
        });
        streamsRef.current.clear();
        // Reset resolved counts
        activitiesRef.current = {
          criticalResolved: 0,
          secondaryResolved: 0,
          deferredResolved: 0,
          criticalStarted: 0,
          secondaryStarted: 0,
          deferredStarted: 0,
        };
      }
      updateCurrentStage();
    },
    [],
  );

  /**
   * Build data payloads by stage.
   */
  const stage1Data = streamsRef.current.size > 0 ? streamsRef.current.get('critical')?.data ?? null : null;
  const stage2Data = streamsRef.current.size > 0 ? streamsRef.current.get('secondary')?.data ?? null : null;
  const stage3Data = streamsRef.current.size > 0 ? streamsRef.current.get('deferred')?.data ?? null : null;

  /**
   * Calculate current stage based on resolved streams.
   */
  const updateCurrentStage = useCallback(() => {
    // Rebuild stages from resolved streams only
    const resolvedStages: number[] = [];
    streamsRef.current.forEach((s) => {
      if (s.resolved) {
        if (s.priority === 'critical') resolvedStages.push(1);
        else if (s.priority === 'secondary') resolvedStages.push(2);
        else if (s.priority === 'deferred') resolvedStages.push(3);
      }
    });

    // currentStage is max resolved stage, or 0 if none resolved
    const currentStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
    const lastTransitionAt = performance.now();
    lastStateRef.current = { currentStage, lastTransitionAt };

    // Dispatch timing events for observability
    if (window?.performanceMark) {
      const prevStageValue = valueRef.current.currentStage;
      const eventName = currentStage > prevStageValue
        ? `progressive.reveal.stage:${currentStage}`
        : 'progressive.reveal.reset:0';
      window.performanceMark(eventName);
    }
  }, []);

  /**
   * Memoize final state.
   */
  const value = useMemo(
    (): ProgressiveRevealContextValue => {
      const resolvedCount =
        activitiesRef.current.criticalResolved +
        activitiesRef.current.secondaryResolved +
        activitiesRef.current.deferredResolved;

      return {
        currentStage: resolvedCount > 0 ? Math.max(activitiesRef.current.criticalResolved ? 1 : 0, activitiesRef.current.secondaryResolved ? 2 : 0, activitiesRef.current.deferredResolved ? 3 : 0) : 0,
        lastTransitionAt: lastStateRef.current.lastTransitionAt,
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
      };
    },
    [callbacks, register, resolve, fail, reset, stage1Data, stage2Data, stage3Data],
  );

  return <ProgressiveRevealContext.Provider value={value}>{children}</ProgressiveRevealContext.Provider>;
}

type Activities = {
  criticalResolved: number;
  secondaryResolved: number;
  deferredResolved: number;
  criticalStarted: number;
  secondaryStarted: number;
  deferredStarted: number;
};

// Staging for valueRef so it's accessible in useMemo
const valueRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });