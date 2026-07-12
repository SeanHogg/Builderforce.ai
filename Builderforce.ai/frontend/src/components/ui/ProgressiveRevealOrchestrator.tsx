'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  ProgressiveRevealStream,
  PriorityTier,
  Stage,
  ProgressiveRevealContextValue,
  ProgressiveRevealState,
} from './types';

/**
 * Exported types for module-level consumption — editorial for multiple files.
 */
export type { ProgressiveRevealStream, PriorityTier, Stage, ProgressiveRevealContextValue, ProgressiveRevealState };

export type Activities = {
  criticalResolved: number;
  secondaryResolved: number;
  deferredResolved: number;
  criticalStarted: number;
  secondaryStarted: number;
  deferredStarted: number;
};

export type ProgressiveRevealCallbacks = {
  onStreamResolve?: (stream: ProgressiveRevealStream) => void;
  onStreamTimeout?: (stream: ProgressiveRevealStream) => void;
};

type DefaultTimeouts = Record<PriorityTier, number>;
const timeouts: DefaultTimeouts = {
  critical: 5000,
  secondary: 10000,
  deferred: 15000,
};

/**
 * Orchestrate streaming within React components — high-level AP.
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

  /** Compute current stage from resolved streams */
  const updateCurrentStage = useCallback(() => {
    const resolvedStages: number[] = [];
    streamsRef.current.forEach((s) => {
      if (!s.resolved) return;
      switch (s.priority) {
        case 'critical': resolvedStages.push(1); break;
        case 'secondary': resolvedStages.push(2); break;
        case 'deferred': resolvedStages.push(3); break;
      }
    });
    const currentStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
    lastStateRef.current = { currentStage, lastTransitionAt: performance.now() };

    if (typeof window !== 'undefined' && window.performanceMark) {
      window.performanceMark('progressive.reveal.stage:transition');
    }
  }, []);

  /** Fetch timeout for a priority tier */
  const getTimeout = useCallback((priority: PriorityTier): number => timeouts[priority] ?? 10000, []);

  /** Register a stream and start timeout tracking */
  const register = useCallback(
    (key: string, priority: PriorityTier, timeoutMs?: number) => {
      const existing = streamsRef.current.get(key);
      if (existing) return;

      const effectiveTimeout = timeoutMs ?? timeouts[priority];
      streamsRef.current.set(key, {
        key,
        priority,
        resolved: false,
        data: null,
        error: null,
        timestamp: 0,
        timeoutMs: effectiveTimeout,
      });

      deals[stream.key] = setTimeout(() => {
        const cur = streamsRef.current.get(key);
        if (cur && !cur.resolved) {
          const err = new Error(`${key} timed out after ${effectiveTimeout}ms`);
          if ((deals[stream.key] as any)) clearTimeout((deals[stream.key] as any));
          fail(key, err);
        }
      }, effectiveTimeout);

      activitiesRef.current[priority + 'Started']++;
    },
    [],
  );

  /** Resolve a stream and trigger stage progression */
  const resolve = useCallback(
    (key: string, data: unknown) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      streamsRef.current.set(key, {
        ...stream,
        resolved: true,
        data,
        timestamp: performance.now(),
        error: null,
        timeoutMs: undefined,
      });
      if (deals[stream.key]) clearTimeout(deals[stream.key] as any);
      delete deals[stream.key];

      callbacks?.onStreamResolve?.(streamsRef.current.get(key)!);
      activitiesRef.current[stream.priority + 'Resolved']++;
      updateCurrentStage();
    },
    [callbacks, updateCurrentStage],
  );

  /** Fail a stream and trigger stage progression */
  const fail = useCallback(
    (key: string, error: Error) => {
      const stream = streamsRef.current.get(key);
      if (!stream || stream.resolved) return;

      streamsRef.current.set(key, {
        ...stream,
        resolved: false,
        error,
        timestamp: performance.now(),
        timeoutMs: undefined,
      });
      if (deals[stream.key]) clearTimeout(deals[stream.key] as any);
      delete deals[stream.key];

      callbacks?.onStreamTimeout?.(streamsRef.current.get(key)!);
      updateCurrentStage();
    },
    [callbacks, updateCurrentStage],
  );

  /** Reset specific stream or all */
  const reset = useCallback((key?: string) => {
    if (key) {
      const s = streamsRef.current.get(key);
      if (s) {
        if (deals[s.key]) clearTimeout(deals[s.key] as any);
        delete deals[s.key];
        streamsRef.current.delete(key);
        activitiesRef.current[s.priority + 'Started']--;
      }
    } else {
      streamsRef.current.forEach((s) => {
        if (deals[s.key]) clearTimeout(deals[s.key] as any);
        delete deals[s.key];
        activitiesRef.current[s.priority + 'Started']--;
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
      updateCurrentStage();
    }
  }, [updateCurrentStage]);

  /** Stage-data slices; null when no streams are tracked */
  const stage1Data = streamsRef.current.size > 0 ? streamsRef.current.get('critical')?.data ?? null : null;
  const stage2Data = streamsRef.current.size > 0 ? streamsRef.current.get('secondary')?.data ?? null : null;
  const stage3Data = streamsRef.current.size > 0 ? streamsRef.current.get('deferred')?.data ?? null : null;

  /** Publishes the scoped context value */
  const value = useMemo((): ProgressiveRevealContextValue => {
    const resolvedCount =
      activitiesRef.current.criticalResolved +
      activitiesRef.current.secondaryResolved +
      activitiesRef.current.deferredResolved;

    return {
      currentStage: resolvedCount > 0
        ? Math.max(
            activitiesRef.current.criticalResolved ? 1 : 0,
            activitiesRef.current.secondaryResolved ? 2 : 0,
            activitiesRef.current.deferredResolved ? 3 : 0,
          )
        : 0,
      lastTransitionAt: lastStateRef.current.lastTransitionAt
        ? Number(lastStateRef.current.lastTransitionAt.toFixed(3))
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
  }, [callbacks, register, resolve, fail, reset, stage1Data, stage2Data, stage3Data]);

  /** Periodic housekeeping: abortable timers on unmount */
  useEffect(() => {
    return () => {
      streamsRef.current.forEach((s) => {
        if (deals[s.key]) clearTimeout(deals[s.key] as any);
      });
    };
  }, []);

  return <ProgressiveRevealContext.Provider value={value}>{children}</ProgressiveRevealContext.Provider>;
}

const deals = new Map<string, NodeJS.Timeout>();

/** Hook for consumers */
export function useProgressiveReveal() {
  const ctx = React.useContext(ProgressiveRevealContext);
  if (!ctx) throw new Error('Missing ProgressiveRevealOrchestrator ancestor');
  return ctx;
}