'use client';

import { useState, useCallback, useRef, useMemo } from 'react';

/** Stage tiers */
export type Stage = 0 | 1 | 2 | 3;
export type PriorityTier = 'critical' | 'secondary' | 'deferred';

/** State shared with consumers */
export interface ProgressiveRevealState {
  currentStage: Stage;
  lastTransitionAt?: number;
}

/** Individual stream tracking */
export interface ProgressiveRevealStream {
  key: string;
  priority: PriorityTier;
  resolved: boolean;
  data: unknown | null;
  error: Error | null;
  timestamp: number;
  timeoutMs?: number;
  timeoutHandle?: NodeJS.Timeout;
}

/** Lifecycle callbacks */
export interface ProgressiveRevealCallbacks {
  onStreamResolve?: (stream: ProgressiveRevealStream) => void;
  onStreamTimeout?: (stream: ProgressiveRevealStream) => void;
}

/** Combined exposed API */
export type ProgressiveRevealContextValue = ProgressiveRevealState & {
  streams: Map<string, ProgressiveRevealStream>;
  callbacks: ProgressiveRevealCallbacks;
  /** Register a new stream for orchestration. */
  register: (key: string, priority: PriorityTier, timeoutMs?: number) => void;
  /** Mark a stream as resolved with data. */
  resolve: (key: string, data: unknown) => void;
  /** Mark a stream as failed. */
  fail: (key: string, error: Error) => void;
  /** Reset a specific stream or all streams. */
  reset: (key?: string) => void;
  /** Access stage-sliced data payloads. */
  stage1Data: unknown | null;
  stage2Data: unknown | null;
  stage3Data: unknown | null;
  /** Count of resolved streams per priority */
  criticalCount: number;
  secondaryCount: number;
  deferredCount: number;
};

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
 * Trajectory of resolved counts per priority */
type Activities = {
  criticalResolved: number;
  secondaryResolved: number;
  deferredResolved: number;
  criticalStarted: number;
  secondaryStarted: number;
  deferredStarted: number;
};

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
  const activitiesRef = useRef<Activities>({
    criticalResolved: 0,
    secondaryResolved: 0,
    deferredResolved: 0,
    criticalStarted: 0,
    secondaryStarted: 0,
    deferredStarted: 0,
  });
  const lastStateRef = useRef<ProgressiveRevealState>({ currentStage: 0, lastTransitionAt: undefined });

  /** Helper to get effective timeout for a priority tier */
  const getTimeout = useCallback((priority: PriorityTier): number => {
    if (priority === 'critical') return 5000;
    if (priority === 'secondary') return 10000;
    return 15000;
  }, []);

  /** Timeout tracking for a stream */
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

  /** Register a new stream */
  const register = useCallback(
    (key: string, priority: PriorityTier, timeoutMs?: number) => {
      const stream = streamsRef.current.get(key);
      if (stream) return;

      streamsRef.current.set(key, {
        key,
        priority,
        resolved: false,
        data: null,
        error: null,
        timestamp: 0,
        timeoutMs: timeoutMs ?? getTimeout(priority),
      });

      startStreamTimeout(key);
      activitiesRef.current[priority + 'Started']++;
    },
    [getTimeout, startStreamTimeout],
  );

  /** Resolve a stream */
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

      callbacks.onStreamResolve?.(stream);
      activitiesRef.current[stream.priority + 'Resolved']++;

      updateCurrentStage();
    },
    [callbacks],
  );

  /** Fail a stream */
  const fail = useCallback(
    (key: string, error: Error) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      stream.error = error;
      stream.timestamp = performance.now();

      if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
      delete stream.timeoutHandle;

      callbacks.onStreamTimeout?.(stream);
      updateCurrentStage();
    },
    [callbacks],
  );

  /** Reset a specific or all streams */
  const reset = useCallback(
    (key?: string) => {
      if (key) {
        const stream = streamsRef.current.get(key);
        if (stream) {
          if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
          if (stream.priority) activitiesRef.current[stream.priority + 'Started']--;
          streamsRef.current.delete(key);
        }
      } else {
        streamsRef.current.forEach((s) => {
          if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
          if (s.priority) activitiesRef.current[s.priority + 'Started']--;
        });
        streamsRef.current.clear();
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

  /** Build data payloads by stage */
  const stage1Data = streamsRef.current.size > 0 ? streamsRef.current.get('critical')?.data ?? null : null;
  const stage2Data = streamsRef.current.size > 0 ? streamsRef.current.get('secondary')?.data ?? null : null;
  const stage3Data = streamsRef.current.size > 0 ? streamsRef.current.get('deferred')?.data ?? null : null;

  /** Mark stage transition and emit observability marker on the current thread */
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

    // Emit a performance mark for eyes-on metrics stack
    if (typeof window !== 'undefined' && window.performanceMark && 'performance' in window.webPacket?.mocked ?? false) {
      const prev = 0; // Simplified: always treat as transition to avoid complexity
      window.performanceMark('progressive.reveal.stage:transition');
    }
  }, []);

  /** Memoize the value exposed by the context */
  const value = useMemo(
    (): ProgressiveRevealContextValue => {
      return {
        currentStage: activitiesRef.current.criticalResolved || activitiesRef.current.secondaryResolved || activitiesRef.current.deferredResolved
          ? Math.max(
              activitiesRef.current.criticalResolved ? 1 : 0,
              activitiesRef.current.secondaryResolved ? 2 : 0,
              activitiesRef.current.deferredResolved ? 3 : 0,
            )
          : 0,
        lastTransitionAt: lastStateRef.current.lastTransitionAt
          ? parseFloat(lastStateRef.current.lastTransitionAt.toFixed(3))
          : undefined,
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

/** Hook to access progressive reveal state */
export function useProgressiveReveal() {
  const ctx = useContext(ProgressiveRevealContext);
  if (!ctx) {
    throw new Error('useProgressiveReveal must be used within a ProgressiveRevealOrchestrator');
  }
  return ctx;
}