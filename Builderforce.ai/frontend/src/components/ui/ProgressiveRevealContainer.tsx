'use client';

import { createContext, useContext, useRef, useCallback, useMemo } from 'react';
import type {
  ProgressiveRevealContextValue,
  ProgressiveRevealState,
  ProgressiveRevealStream,
  PriorityTier,
  Stage,
} from './ProgressiveRevealContext';

/**
 * Minimal ref to hold the last known state for observability hooks, separate from the computed stage.
 */
const lastStateRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });

export interface ProgressiveRevealCallbacks {
  onStreamResolve?: (stream: ProgressiveRevealStream) => void;
  onStreamTimeout?: (stream: ProgressiveRevealStream) => void;
}

/**
 * ProgressiveRevealContainer is the central orchestrator provider.
 * It tracks stream statuses, timeouts, stages, and exposes callbacks for observability.
 */
export function ProgressiveRevealContainer({
  children,
  initialCallbacks,
}: {
  children: React.ReactNode;
  initialCallbacks?: ProgressiveRevealCallbacks;
}) {
  const streamsRef = useRef<Map<string, ProgressiveRevealStream>>(new Map());
  const callbacksRef = useRef<ProgressiveRevealCallbacks>(initialCallbacks || {});
  const lastStateRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });

  const activityCountsRef = useRef<{
    criticalResolved: number;
    secondaryResolved: number;
    deferredResolved: number;
    criticalStarted: number;
    secondaryStarted: number;
    deferredStarted: number;
  }>({
    criticalResolved: 0,
    secondaryResolved: 0,
    deferredResolved: 0,
    criticalStarted: 0,
    secondaryStarted: 0,
    deferredStarted: 0,
  });

  // Default timeout per priority tier (ms)
  const getTimeout = useCallback((priority: PriorityTier): number | undefined => {
    switch (priority) {
      case 'critical':
        return 5_000;
      case 'secondary':
        return 10_000;
      case 'deferred':
        return 15_000;
    }
  }, []);

  // Register a stream and start timeout tracking
  const register = useCallback(
    (key: string, priority: PriorityTier, timeoutMs?: number) => {
      const stream = streamsRef.current.get(key);
      if (stream) return; // Already registered

      const effectiveTimeout = timeoutMs ?? getTimeout(priority);

      streamsRef.current.set(key, {
        key,
        priority,
        resolved: false,
        data: null,
        error: null,
        timestamp: 0,
        timeoutMs: effectiveTimeout,
        timeoutHandle: undefined,
      });

      activityCountsRef.current[priority + 'Started']++;

      // Start timeout
      const timeoutId = setTimeout(() => {
        const current = streamsRef.current.get(key);
        if (current && !current.resolved) {
          const error = new Error(`Stream ${key} timed out after ${effectiveTimeout}ms`);
          if (current.timeoutHandle) clearTimeout(current.timeoutHandle);
          fail(key, error);
        }
        // Clear own handle
        if (current?.timeoutHandle === timeoutId) {
          current.timeoutHandle = undefined;
        }
      }, effectiveTimeout);

      const updatedStream = streamsRef.current.get(key);
      if (updatedStream) {
        updatedStream.timeoutHandle = timeoutId;
      }
    },
    [getTimeout],
  );

  // Resolve a stream
  const resolve = useCallback(
    (key: string, data: unknown) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      stream.resolved = true;
      stream.data = data;
      stream.timestamp = performance.now();
      stream.error = null;

      if (stream.timeoutHandle) {
        clearTimeout(stream.timeoutHandle);
        stream.timeoutHandle = undefined;
      }

      callbacksRef.current.onStreamResolve?.(stream);
      activityCountsRef.current[stream.priority + 'Resolved']++;
      updateCurrentStage();
    },
    [],
  );

  // Fail a stream (timeout or explicit error)
  const fail = useCallback(
    (key: string, error: Error) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      stream.error = error;
      stream.timestamp = performance.now();

      if (stream.timeoutHandle) {
        clearTimeout(stream.timeoutHandle);
        stream.timeoutHandle = undefined;
      }

      callbacksRef.current.onStreamTimeout?.(stream);
      updateCurrentStage();
    },
    [],
  );

  // Reset a stream or all streams
  const reset = useCallback((key?: string) => {
    if (key) {
      const stream = streamsRef.current.get(key);
      if (stream) {
        if (stream.timeoutHandle) {
          clearTimeout(stream.timeoutHandle);
        }
        if (stream.priority) {
          activityCountsRef.current[stream.priority + 'Started']--;
        }
        streamsRef.current.delete(key);
      }
    } else {
      streamsRef.current.forEach((stream) => {
        if (stream.timeoutHandle) {
          clearTimeout(stream.timeoutHandle);
        }
        if (stream.priority) {
          activityCountsRef.current[stream.priority + 'Started']--;
        }
      });
      streamsRef.current.clear();
      activityCountsRef.current = {
        criticalResolved: 0,
        secondaryResolved: 0,
        deferredResolved: 0,
        criticalStarted: 0,
        secondaryStarted: 0,
        deferredStarted: 0,
      };
    }
    updateCurrentStage();
  }, []);

  // Build stage-sliced data payloads
  const stage1Data = streamsRef.current.size > 0 ? streamsRef.current.get('critical')?.data ?? null : null;
  const stage2Data = streamsRef.current.size > 0 ? streamsRef.current.get('secondary')?.data ?? null : null;
  const stage3Data = streamsRef.current.size > 0 ? streamsRef.current.get('deferred')?.data ?? null : null;

  // Determine current stage from resolved streams
  const updateCurrentStage = useCallback(() => {
    const resolvedStages: Stage[] = [];
    streamsRef.current.forEach((s) => {
      if (s.resolved) {
        if (s.priority === 'critical') resolvedStages.push(1);
        else if (s.priority === 'secondary') resolvedStages.push(2);
        else if (s.priority === 'deferred') resolvedStages.push(3);
      }
    });

    const currentStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
    const lastTransitionAt = performance.now();

    lastStateRef.current = { currentStage, lastTransitionAt };

    // Emit performance mark for observability
    if (typeof window !== 'undefined' && 'performance' in window) {
      window.performanceMark?.(`progressive.reveal.stage:${currentStage}`);
    }
  }, []);

  // Memoize final exposed value
  const value = useMemo(
    (): ProgressiveRevealContextValue => ({
      currentStage:
        activityCountsRef.current.criticalResolved ||
        activityCountsRef.current.secondaryResolved ||
        activityCountsRef.current.deferredResolved
          ? Math.max(
              activityCountsRef.current.criticalResolved ? 1 : 0,
              activityCountsRef.current.secondaryResolved ? 2 : 0,
              activityCountsRef.current.deferredResolved ? 3 : 0
            )
          : 0,
      lastTransitionAt: lastStateRef.current.lastTransitionAt,
      streams: streamsRef.current,
      callbacks: callbacksRef.current,
      register,
      resolve,
      fail,
      reset,
      stage1Data,
      stage2Data,
      stage3Data,
      criticalCount: activityCountsRef.current.criticalResolved,
      secondaryCount: activityCountsRef.current.secondaryResolved,
      deferredCount: activityCountsRef.current.deferredResolved,
    }),
    [
      activityCountsRef.current,
      lastStateRef.current.lastTransitionAt,
      streamsRef.current,
      callbacksRef.current,
      register,
      resolve,
      fail,
      reset,
      stage1Data,
      stage2Data,
      stage3Data,
    ]
  );

  return (
    <ProgressiveRevealContext.Provider value={value}>{children}</ProgressiveRevealContext.Provider>
  );
}

// Re-export the hook from the context
export const useProgressiveReveal = () => useContext(ProgressiveRevealContext);