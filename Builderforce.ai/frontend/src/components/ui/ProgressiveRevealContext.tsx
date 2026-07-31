'use client';

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProgressiveRevealStream,
  PriorityTier,
  Stage,
  ProgressiveRevealContextValue,
  ProgressiveRevealCallbacks,
} from './types';

// --------------- defaults ---------------

const DEFAULT_TIMEOUTS: Record<PriorityTier, number> = {
  critical: 5000,
  secondary: 10000,
  deferred: 15000,
};

const DEFAULT_CALLBACKS: ProgressiveRevealCallbacks = {};

// --------------- context (default value satisfies the type so consumers detect a missing provider reliably) ---------------

const NOOP = () => {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.warn('ProgressiveReveal: called outside a <ProgressiveRevealOrchestrator> provider');
  }
};

export const ProgressiveRevealContext = React.createContext<ProgressiveRevealContextValue>({
  currentStage: 0,
  lastTransitionAt: undefined,
  streams: new Map(),
  callbacks: DEFAULT_CALLBACKS,
  register: NOOP,
  resolve: NOOP,
  append: NOOP,
  fail: NOOP,
  retry: NOOP,
  reset: NOOP,
  stage1Data: null,
  stage2Data: null,
  stage3Data: null,
  criticalCount: 0,
  secondaryCount: 0,
  deferredCount: 0,
});

ProgressiveRevealContext.displayName = 'ProgressiveRevealContext';

// --------------- internal bean (kept light — no Map-wrapping overhead) ---------------

interface StreamBean {
  key: string;
  priority: PriorityTier;
  resolved: boolean;
  data: unknown | null;
  error: Error | null;
  timestamp: number;
  timeoutMs: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  chunks: unknown[];
}

// --------------- orchestrator ---------------

export function ProgressiveRevealOrchestrator({
  children,
  callbacks,
}: {
  children: React.ReactNode;
  callbacks?: ProgressiveRevealCallbacks;
}) {
  // ---- mutable refs (avoids stale closure over state) ----
  const streamsRef = useRef<Map<string, StreamBean>>(new Map());
  const callbacksRef = useRef<ProgressiveRevealCallbacks>(callbacks ?? DEFAULT_CALLBACKS);
  callbacksRef.current = callbacks ?? DEFAULT_CALLBACKS;

  // ---- reactive state: subset needed for rendering ----
  const [tick, setTick] = useState(0); // cheap render trigger

  const [reactive, setReactive] = useState<{
    currentStage: Stage;
    lastTransitionAt: number | undefined;
    stage1Data: unknown | null;
    stage2Data: unknown | null;
    stage3Data: unknown | null;
    criticalCount: number;
    secondaryCount: number;
    deferredCount: number;
  }>({
    currentStage: 0,
    lastTransitionAt: undefined,
    stage1Data: null,
    stage2Data: null,
    stage3Data: null,
    criticalCount: 0,
    secondaryCount: 0,
    deferredCount: 0,
  });

  // ---- helpers ----

  const getTimeoutMs = useCallback((priority: PriorityTier): number => {
    return DEFAULT_TIMEOUTS[priority] ?? 10000;
  }, []);

  const latestStage = useCallback((streams: Map<string, StreamBean>): Stage => {
    let max: Stage = 0;
    streams.forEach(s => {
      if (!s.resolved && s.chunks.length === 0) return;
      switch (s.priority) {
        case 'critical':
          max = Math.max(max, 1);
          break;
        case 'secondary':
          max = Math.max(max, 2);
          break;
        case 'deferred':
          max = Math.max(max, 3);
          break;
      }
    });
    return max;
  }, []);

  const counts = useCallback(
    (streams: Map<string, StreamBean>) => {
      let criticalCount = 0;
      let secondaryCount = 0;
      let deferredCount = 0;
      streams.forEach(s => {
        if (s.resolved || s.chunks.length > 0) {
          switch (s.priority) {
            case 'critical':
              criticalCount++;
              break;
            case 'secondary':
              secondaryCount++;
              break;
            case 'deferred':
              deferredCount++;
              break;
          }
        }
      });
      return { criticalCount, secondaryCount, deferredCount };
    },
    [],
  );

  /** Recompute reactive state from the ref and trigger a render. */
  const sync = useCallback(() => {
    const s = streamsRef.current;
    const stage = latestStage(s);
    const cnt = counts(s);

    const stage1Bean = s.get('critical');
    const stage2Bean = s.get('secondary');
    const stage3Bean = s.get('deferred');

    setReactive(prev => ({
      currentStage: stage,
      lastTransitionAt: stage !== prev.currentStage ? performance.now() : prev.lastTransitionAt,
      stage1Data: stage1Bean?.data ?? null,
      stage2Data: stage2Bean?.data ?? null,
      stage3Data: stage3Bean?.data ?? null,
      criticalCount: cnt.criticalCount,
      secondaryCount: cnt.secondaryCount,
      deferredCount: cnt.deferredCount,
    }));

    setTick(t => t + 1);
  }, [latestStage, counts]);

  // ---- register ----

  const register = useCallback(
    (key: string, priority: PriorityTier, overrideTimeout?: number) => {
      const s = streamsRef.current;
      if (s.has(key)) return;

      const timeoutMs = overrideTimeout ?? getTimeoutMs(priority);
      const bean: StreamBean = {
        key,
        priority,
        resolved: false,
        data: null,
        error: null,
        timestamp: performance.now(),
        timeoutMs,
        timeoutHandle: undefined,
        chunks: [],
      };

      // Schedule timeout — capture the KEY, not the stale bean
      bean.timeoutHandle = setTimeout(() => {
        const fresh = streamsRef.current.get(key);
        if (!fresh || fresh.resolved || fresh.error) return;
        // need to call fail imperatively — use the captured ref callback
        const err = new Error(`${key} timed out after ${timeoutMs}ms`);
        const b = streamsRef.current.get(key);
        if (b && !b.resolved && !b.error) {
          if (b.timeoutHandle) clearTimeout(b.timeoutHandle);
          b.error = err;
          b.timeoutHandle = undefined;
          b.timestamp = performance.now();
          callbacksRef.current.onStreamTimeout?.(
            b as unknown as ProgressiveRevealStream,
          );
          sync();
        }
      }, timeoutMs);

      s.set(key, bean);
      sync();
    },
    [getTimeoutMs, sync],
  );

  // ---- resolve ----

  const resolve = useCallback(
    (key: string, data: unknown) => {
      const bean = streamsRef.current.get(key);
      if (!bean || bean.resolved) return;

      if (bean.timeoutHandle) {
        clearTimeout(bean.timeoutHandle);
        bean.timeoutHandle = undefined;
      }
      bean.resolved = true;
      bean.data = data;
      bean.timestamp = performance.now();

      callbacksRef.current.onStreamResolve?.(
        bean as unknown as ProgressiveRevealStream,
      );
      sync();
    },
    [sync],
  );

  // ---- append (FR-4: chunked / streaming data) ----

  const append = useCallback(
    (key: string, chunk: unknown) => {
      const bean = streamsRef.current.get(key);
      if (!bean) return;

      bean.chunks.push(chunk);
      bean.timestamp = performance.now();
      // Do NOT mark resolved — stream may deliver more chunks later.
      sync();
    },
    [sync],
  );

  // ---- fail ----

  const fail = useCallback(
    (key: string, error: Error) => {
      const bean = streamsRef.current.get(key);
      if (!bean || bean.resolved || bean.error) return;

      if (bean.timeoutHandle) {
        clearTimeout(bean.timeoutHandle);
        bean.timeoutHandle = undefined;
      }
      bean.error = error;
      bean.timestamp = performance.now();

      callbacksRef.current.onStreamTimeout?.(
        bean as unknown as ProgressiveRevealStream,
      );
      sync();
    },
    [sync],
  );

  // ---- retry (AC-8) ----

  const retry = useCallback(
    (key: string) => {
      const bean = streamsRef.current.get(key);
      if (!bean) return;
      // Only reset failed / timed-out streams — not resolved ones.
      if (!bean.error && bean.resolved) return;

      if (bean.timeoutHandle) {
        clearTimeout(bean.timeoutHandle);
        bean.timeoutHandle = undefined;
      }

      // Reset in-place so consuming components re-render without needing
      // to call register() again (which would be guarded by `has(key)`).
      bean.resolved = false;
      bean.error = null;
      bean.data = null;
      bean.chunks = [];
      bean.timestamp = performance.now();

      // Restart the timeout timer.
      const timeoutMs = bean.timeoutMs ?? getTimeoutMs(bean.priority);
      bean.timeoutHandle = setTimeout(() => {
        const b = streamsRef.current.get(key);
        if (!b || b.resolved || b.error) return;
        if (b.timeoutHandle) clearTimeout(b.timeoutHandle);
        b.error = new Error(`${key} timed out after ${timeoutMs}ms`);
        b.timeoutHandle = undefined;
        b.timestamp = performance.now();
        callbacksRef.current.onStreamTimeout?.(
          b as unknown as ProgressiveRevealStream,
        );
        sync();
      }, timeoutMs);

      sync();
    },
    [getTimeoutMs, sync],
  );

  // ---- reset ----

  const reset = useCallback(
    (key?: string) => {
      const s = streamsRef.current;
      if (key) {
        const bean = s.get(key);
        if (bean?.timeoutHandle) clearTimeout(bean.timeoutHandle);
        s.delete(key);
      } else {
        s.forEach(b => {
          if (b.timeoutHandle) clearTimeout(b.timeoutHandle);
        });
        s.clear();
      }
      sync();
    },
    [sync],
  );

  // ---- re-compute stage whenever stage transitions happen (AC-10) ----

  const prevStage = useRef<Stage>(0);
  useEffect(() => {
    const cur = reactive.currentStage;
    if (cur !== prevStage.current) {
      callbacksRef.current.onStageTransition?.(
        prevStage.current,
        cur,
        performance.now(),
      );
      prevStage.current = cur;
    }
  }, [reactive.currentStage]);

  // ---- cleanup on unmount ----
  useEffect(() => {
    return () => {
      streamsRef.current.forEach(b => {
        if (b.timeoutHandle) clearTimeout(b.timeoutHandle);
      });
    };
  }, []);

  // ---- context value (stable reference — only tick changes trigger consumers) ----

  const value = useMemo<ProgressiveRevealContextValue>(
    () => ({
      currentStage: reactive.currentStage,
      lastTransitionAt: reactive.lastTransitionAt,
      streams: streamsRef.current,
      callbacks: callbacksRef.current,
      register,
      resolve,
      append,
      fail,
      retry,
      reset,
      stage1Data: reactive.stage1Data,
      stage2Data: reactive.stage2Data,
      stage3Data: reactive.stage3Data,
      criticalCount: reactive.criticalCount,
      secondaryCount: reactive.secondaryCount,
      deferredCount: reactive.deferredCount,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, reactive, register, resolve, append, fail, retry, reset],
  );

  return (
    <ProgressiveRevealContext.Provider value={value}>
      {children}
    </ProgressiveRevealContext.Provider>
  );
}

// --------------- hook ---------------

export function useProgressiveReveal(): ProgressiveRevealContextValue {
  const ctx = useContext(ProgressiveRevealContext);
  // ctx is never null because createContext provides a default —
  // but we detect the default no-op to warn about a missing provider.
  if (ctx.register === NOOP) {
    throw new Error(
      'useProgressiveReveal must be used within a <ProgressiveRevealOrchestrator>',
    );
  }
  return ctx;
}
