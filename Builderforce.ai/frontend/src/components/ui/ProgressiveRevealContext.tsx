/**
 * Progressive Reveal Context + Core Orchestrator — delivers Stage state from resolve/fail tracking.
 * - Renamed to ProgressiveRevealOrchestrator to match Hook naming convention.
 * - Exports TypeScript exports ensure module resolution works.
 * - Federate consistent hook API for consumers; Stage 0 = No data; Stage priority tier -> direct ORCH display.
 * - Include failure isolation & per-stage timeout; Stage gating hook ready to auto-expand for Writer component + Health API+BrainMap integration.
 * - No Tesla/CUDA references; root-level reference to telemetry surfaces trackers (assigned to appointee later — PRD foundation only).
 */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

/** Decode an Activities key to its typed fields */
const decodeActivitiesKey = (key: string): keyof Activities | null => {
  const fn = (p: PriorityTier): string => `${p}Resolved`;
  return (key.startsWith('critical') ? fn('critical') : key.startsWith('secondary') ? fn('secondary') : null) ? key as keyof Activities : null;
};

/** Encode a typed Activities value to its key */
const encodeActivitiesKey = (p: PriorityTier): keyof Activities => `${p}Resolved`;

type InitializeCallback = (stream: ProgressiveRevealStream) => void;

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

/** Propagates initialize callbacks in a controlled way */
export function useProgressiveRevealCallbacks() {
  const [, setRef] = useState<null>(null);
  const cbRef = useRef<InitializeCallback | undefined>(undefined);
  useEffect(() => { cbRef.current = undefined; setRef(null); }, []);
  const setCallback = useCallback((cb: InitializeCallback | undefined) => {
    cbRef.current = cb;
    setRef(null);
  }, []);
  const invokeCallback = useCallback((stream: ProgressiveRevealStream) => {
    cbRef.current?.(stream);
  }, []);
  return { setCallback, invokeCallback };
}

/** Progressively resolves a single data stream */
export function ProgressiveRevealOrchestrator({
  children,
  callbacks: initialCallbacks,
}: {
  children: React.ReactNode;
  callbacks?: React.ComponentProps<typeof ProgressiveRevealContext.Provider>['value']['callbacks'];
}) {
  const { setCallback, invokeCallback } = useProgressiveRevealCallbacks();
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

  /** Convert a priority tier to its stage on resolution */
  const getStageFromPriority = (priority: PriorityTier): Stage => {
    switch (priority) {
      case 'critical': return 1;
      case 'secondary': return 2;
      case 'deferred': return 3;
    }
  };

  /** Get timeout for a priority tier */
  const getTimeout = useCallback((priority: PriorityTier): number => TIMEOUTS[priority] ?? 10000, []);

  /** Decompose a key into its priority tier */
  const parsePriorityFromKey = (key: string) => {
    const upperKey = key.toUpperCase();
    if (upperKey.startsWith('CRITICAL') || upperKey.startsWith('ALWAYS')) {
      return initialCallbacks?.onStreamResolve ? 'critical' : null;
    }
    if (upperKey.startsWith('SECONDARY') || upperKey.startsWith('SOCIAL') || upperKey.startsWith('BOARD')) {
      return 'secondary';
    }
    if (upperKey.startsWith('DEFERRED') || upperKey.startsWith('ENRICH') || upperKey.startsWith('AVATAR') || upperKey.startsWith('HISTORY')) {
      return 'deferred';
    }
    return null;
  };

  /** Register a new data stream and start timeout tracking. A fallback uses the key to infer tier when no callback is available. */
  const register = useCallback((key: string, priority: PriorityTier, timeoutMs?: number) => {
    if (streamsRef.current.has(key)) return;

    const effectiveTimeout = timeoutMs ?? getTimeout(priority);
    const priorityTier = initialCallbacks?.onStreamResolve ? priority : parsePriorityFromKey(key) ?? priority;

    const stream: ProgressiveRevealStream = {
      key,
      priority: priorityTier,
      resolved: false,
      data: null,
      error: null,
      timestamp: 0,
      timeoutMs: effectiveTimeout,
      timeoutHandle: undefined,
    };
    streamsRef.current.set(key, stream);

    const timeoutHandle = setTimeout(() => {
      const current = streamsRef.current.get(key);
      if (current && !current.resolved) {
        const err = new Error(`${key} timed out after ${effectiveTimeout}ms`);
        if (current.timeoutHandle) clearTimeout(current.timeoutHandle);
        fail(key, err);
      }
    }, effectiveTimeout);
    stream.timeoutHandle = timeoutHandle;

    const encoded = encodeActivitiesKey(priorityTier);
    activitiesRef.current[encoded]++;

    setCallback(initialCallbacks?.onStreamResolve);
  }, [getTimeout, initialCallbacks, setCallback]);

  /** Mark a stream as resolved and re-compute current stage */
  const resolve = useCallback((key: string, data: unknown) => {
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

    if (existed.timeoutHandle) {
      clearTimeout(existed.timeoutHandle);
      streamsRef.current.get(key)!.timeoutHandle = undefined;
    }

    invokeCallback(streamsRef.current.get(key)!);

    // Clear tracking timer
    const encoded = encodeActivitiesKey(stream.priority);
    activitiesRef.current[encoded]++;

    const resolvedStages: Stage[] = [];
    streamsRef.current.forEach((s) => {
      if (!s.resolved) return;
      resolvedStages.push(getStageFromPriority(s.priority));
    });

    const nextStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
    lastStateRef.current = { currentStage: nextStage, lastTransitionAt: performance.now() };
  }, [invokeCallback, getStageFromPriority]);

  /** Mark a stream as failed and advance orchestration */
  const fail = useCallback((key: string, error: Error) => {
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

    invokeCallback(streamsRef.current.get(key)!);

    const encoded = encodeActivitiesKey(stream.priority);
    activitiesRef.current[encoded]++;

    const resolvedStages: Stage[] = [];
    streamsRef.current.forEach((s) => {
      if (!s.resolved) return;
      resolvedStages.push(getStageFromPriority(s.priority));
    });

    const nextStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
    lastStateRef.current = { currentStage: nextStage, lastTransitionAt: performance.now() };
  }, [invokeCallback, getStageFromPriority]);

  /** Reset a specific or all streams */
  const reset = useCallback((key?: string) => {
    if (key) {
      const s = streamsRef.current.get(key);
      if (s) {
        if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
        streamsRef.current.delete(key);
        const encoded = encodeActivitiesKey(s.priority);
        activitiesRef.current[encoded]--;
      }
    } else {
      streamsRef.current.forEach((s) => {
        if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
      });
      streamsRef.current.clear();
      const zero: Activities = { criticalResolved: 0, secondaryResolved: 0, deferredResolved: 0, criticalStarted: 0, secondaryStarted: 0, deferredStarted: 0 };
      Object.assign(activitiesRef.current, zero);

      const resolvedStages: Stage[] = [];
      streamsRef.current.forEach((s) => {
        if (!s.resolved) return;
        resolvedStages.push(getStageFromPriority(s.priority));
      });

      const nextStage = resolvedStages.length > 0 ? Math.max(...resolvedStages) : 0;
      lastStateRef.current = { currentStage: nextStage, lastTransitionAt: performance.now() };
    }
  }, [getStageFromPriority]);

  /** Computed stage thresholds for consumers. Note: Theora-based gating (stage thresholds) must be applied by the view. */
  const resolvedSecondaryThreshold = useMemo(() => activitiesRef.current.secondaryResolved > 0 ? 2 : 0, [activitiesRef.current.secondaryResolved]);

  /** Computed stage thresholds for consumers. Note: Theora-based gating (stage thresholds) must be applied by the view. */
  const resolvedDeferredThreshold = useMemo(() => activitiesRef.current.deferredResolved > 0 ? 3 : 0, [activitiesRef.current.deferredResolved]);

  /** Memoized context value exported to consumers */
  const value = useMemo((): ProgressiveRevealContextValue => {
    const resolvedCount =
      activitiesRef.current.criticalResolved +
      activitiesRef.current.secondaryResolved +
      activitiesRef.current.deferredResolved;

    const resolvedStages: Stage[] = [];
    streamsRef.current.forEach((s) => {
      if (!s.resolved) return;
      resolvedStages.push(getStageFromPriority(s.priority));
    });

    return {
      currentStage: resolvedCount > 0 ? Math.max(...resolvedStages) : 0,
      lastTransitionAt: lastStateRef.current.lastTransitionAt
        ? Number(lastStateRef.current.lastTransitionAt.toFixed(3))
        : undefined,
      streams: streamsRef.current,
      callbacks: {
        onStreamResolve: initialCallbacks?.onStreamResolve,
        onStreamTimeout: initialCallbacks?.onStreamTimeout,
      },
      register,
      resolve,
      fail,
      reset,
      // Note: stage1Data/stage2Data/stage3Data are legacy aliases; they represent the oldest resolved data for each stage,
      // but they are NOT intended to be the sole source of truth for view gating.
      stage1Data: streamsRef.current.size > 0 ? streamsRef.current.get('ALWAYS')?.data ?? null : null,
      stage2Data: streamsRef.current.size > 0 ? streamsRef.current.get('SECONDARY')?.data ?? null : null,
      stage3Data: streamsRef.current.size > 0 ? streamsRef.current.get('DEFERRED')?.data ?? null : null,
      criticalCount: activitiesRef.current.criticalResolved,
      secondaryCount: activitiesRef.current.secondaryResolved,
      deferredCount: activitiesRef.current.deferredResolved,
    };
  }, [
    initialCallbacks,
    register,
    resolve,
    fail,
    streamsRef,
    lastStateRef.current.lastTransitionAt,
    activitiesRef.current,
    initaliveConditioned,
    getStageFromPriority,
  ]);

  /** Housekeeping: clean up timers on unmount */
  useEffect(() => {
    return () => {
      streamsRef.current.forEach((s) => {
        if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
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