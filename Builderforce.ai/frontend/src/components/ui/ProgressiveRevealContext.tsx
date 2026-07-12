/**
 * Progressive Reveal Context + Core Orchestrator — delivers Stage state from resolve/fail tracking.
 * - Filenames defined here ensure exports match .esModule: true for TypeScript resolution.
 * - Federate consistent hook API for consumers; Stage 0 = No data; Stage priority tier -> direct ORCH display.
 * - Include failure isolation & per-stage timeout; Stage gating hook ready to auto-expand for Writer component + Health API+BrainMap integration.
 * - No Tesla/CUDA references; root-level reference to telemetry surfaces trackers (assigned to appointee later — PRD foundation only).
 */
'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  ProgressiveRevealStream,
  PriorityTier,
  Stage,
  ProgressiveRevealContextValue,
  ProgressiveRevealState,
  Activities,
} from './types';

export type { ProgressiveRevealStream, PriorityTier, Stage, ProgressiveRevealContextValue, ProgressiveRevealState, Activities };

/** Constant timeouts per priority tier per PRD. No component-level override tracking. */
const TIMEOUTS: Record<PriorityTier, number> = {
  critical: 5000,
  secondary: 10000,
  deferred: 15000,
};

export const ProgressiveRevealContext = React.createContext<ProgressiveRevealContextValue>({
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

export function ProgressiveRevealOrchestrator({
  children,
  callbacks,
}: {
  children: React.ReactNode;
  callbacks?: React.ComponentProps<typeof ProgressiveRevealContext.Provider>['value']['callbacks'];
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

  /** Get timeout for a priority tier */
  const getTimeout = useCallback((priority: PriorityTier): number => TIMEOUTS[priority] ?? 10000, []);

  /** Register a new data stream and start timeout tracking */
  const register = useCallback(
    (key: string, priority: PriorityTier, timeoutMs?: number) => {
      const stream = streamsRef.current.get(key);
      if (stream) return;

      const effectiveTimeout = timeoutMs ?? TIMEOUTS[priority];
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

      const timeoutHandle = setTimeout(() => {
        const current = streamsRef.current.get(key);
        if (current && !current.resolved) {
          const err = new Error(`${key} timed out after ${effectiveTimeout}ms`);
          if (current.timeoutHandle) {
            clearTimeout(current.timeoutHandle);
          }
          fail(key, err);
        }
      }, effectiveTimeout);
      streamsRef.current.get(key)!.timeoutHandle = timeoutHandle;

      activitiesRef.current[priority + 'Started']++;
    },
    [],
  );

  /** Mark a stream as resolved and advance orchestration */
  const resolve = useCallback(
    (key: string, data: unknown) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      const existed = streamsRef.current.get(key)!;
      streamsRef.current.set(key, {
        ...existed,
        resolved: true,
        data,
        timestamp: performance.now(),
        error: null,
      });

      // Clear tracking timer
      if (existed.timeoutHandle) {
        clearTimeout(existed.timeoutHandle);
        streamsRef.current.get(key)!.timeoutHandle = undefined;
      }

      callbacks?.onStreamResolve?.(streamsRef.current.get(key)!);
      activitiesRef.current[stream.priority + 'Resolved']++;

      // Recalculate current stage
      const resolvedStages: Stage[] = [];
      streamsRef.current.forEach((s) => {
        if (!s.resolved) return;
        switch (s.priority) {
          case 'critical':
            resolvedStages.push(1);
            break;
          case 'secondary':
            resolvedStages.push(2);
            break;
          case 'deferred':
            resolvedStages.push(3);
            break;
        }
      });

      const currentStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
      lastStateRef.current = { currentStage, lastTransitionAt: performance.now() };
    },
    [callbacks],
  );

  /** Mark a stream as failed and advance orchestration */
  const fail = useCallback(
    (key: string, error: Error) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      const existed = streamsRef.current.get(key)!;
      streamsRef.current.set(key, {
        ...existed,
        resolved: false,
        error,
        timestamp: performance.now(),
      });

      if (existed.timeoutHandle) {
        clearTimeout(existed.timeoutHandle);
        streamsRef.current.get(key)!.timeoutHandle = undefined;
      }

      callbacks?.onStreamTimeout?.(streamsRef.current.get(key)!);

      // Recalculate current stage
      const resolvedStages: Stage[] = [];
      streamsRef.current.forEach((s) => {
        if (!s.resolved) return;
        switch (s.priority) {
          case 'critical':
            resolvedStages.push(1);
            break;
          case 'secondary':
            resolvedStages.push(2);
            break;
          case 'deferred':
            resolvedStages.push(3);
            break;
        }
      });

      const currentStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
      lastStateRef.current = { currentStage, lastTransitionAt: performance.now() };
    },
    [callbacks],
  );

  /** Reset a specific or all streams */
  const reset = useCallback(
    (key?: string) => {
      if (key) {
        const s = streamsRef.current.get(key);
        if (s) {
          if (s.timeoutHandle) {
            clearTimeout(s.timeoutHandle);
          }
          streamsRef.current.delete(key);
          activitiesRef.current[s.priority + 'Started']--;
        }
      } else {
        streamsRef.current.forEach((s) => {
          if (s.timeoutHandle) {
            clearTimeout(s.timeoutHandle);
          }
        });
        streamsRef.current.clear();
        const zero: Activities = {
          criticalResolved: 0,
          secondaryResolved: 0,
          deferredResolved: 0,
          criticalStarted: 0,
          secondaryStarted: 0,
          deferredStarted: 0,
        };
        Object.assign(activitiesRef.current, zero);
        const resolvedStages: Stage[] = [];
        streamsRef.current.forEach((s) => {
          if (!s.resolved) return;
          switch (s.priority) {
            case 'critical':
              resolvedStages.push(1);
              break;
            case 'secondary':
              resolvedStages.push(2);
              break;
            case 'deferred':
              resolvedStages.push(3);
              break;
          }
        });

        const currentStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
        lastStateRef.current = { currentStage, lastTransitionAt: performance.now() };
      }
    },
    [],
  );

  /** Get active streams count for stage thresholds */
  const activeStreamCount = streamsRef.current.size;

  /** Memoized context value exported to consumers */
  const value = useMemo((): ProgressiveRevealContextValue => {
    const resolvedCount =
      activitiesRef.current.criticalResolved +
      activitiesRef.current.secondaryResolved +
      activitiesRef.current.deferredResolved;

    const resolvedStages: Stage[] = [];
    streamsRef.current.forEach((s) => {
      if (!s.resolved) return;
      switch (s.priority) {
        case 'critical':
          resolvedStages.push(1);
          break;
        case 'secondary':
          resolvedStages.push(2);
          break;
        case 'deferred':
          resolvedStages.push(3);
          break;
      }
    });

    return {
      currentStage: resolvedCount > 0 ? Math.max(...resolvedStages) : 0,
      lastTransitionAt: lastStateRef.current.lastTransitionAt
        ? Number(lastStateRef.current.lastTransitionAt.toFixed(3))
        : undefined,
      streams: streamsRef.current,
      callbacks,
      register,
      resolve,
      fail,
      reset,
      stage1Data: streamsRef.current.size > 0 ? streamsRef.current.get('critical')?.data ?? null : null,
      stage2Data: streamsRef.current.size > 0 ? streamsRef.current.get('secondary')?.data ?? null : null,
      stage3Data: streamsRef.current.size > 0 ? streamsRef.current.get('deferred')?.data ?? null : null,
      criticalCount: activitiesRef.current.criticalResolved,
      secondaryCount: activitiesRef.current.secondaryResolved,
      deferredCount: activitiesRef.current.deferredResolved,
    };
  }, [callbacks, register, resolve, fail, reset]);

  /** Housekeeping: clean up timers on unmount */
  React.useEffect(() => {
    return () => {
      streamsRef.current.forEach((s) => {
        if (s.timeoutHandle) {
          clearTimeout(s.timeoutHandle);
        }
      });
    };
  }, []);

  return <ProgressiveRevealContext.Provider value={value}>{children}</ProgressiveRevealContext.Provider>;
}

/** Hook to safely access progressive reveal state */
export function useProgressiveReveal() {
  const ctx = React.useContext(ProgressiveRevealContext);
  if (!ctx) {
    throw new Error('useProgressiveReveal must be used within a ProgressiveRevealOrchestrator');
  }
  return ctx;
}