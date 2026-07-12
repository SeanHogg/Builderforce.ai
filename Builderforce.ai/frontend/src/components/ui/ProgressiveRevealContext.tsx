'use client';

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProgressiveRevealStream,
  PriorityTier,
  Stage,
  ProgressiveRevealContextValue,
  ProgressiveRevealState,
} from './types';

const TIMEOUTS: Record<PriorityTier, number> = {
  critical: 5000,
  secondary: 10000,
  deferred: 15000,
};

export const ProgressiveRevealContext = React.createContext<ProgressiveRevealContextValue>({
  currentStage: 0,
  lastTransitionAt: undefined,
  streams: new Map(),
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

interface StreamBean {
  key: string;
  priority: PriorityTier;
  resolved: boolean;
  error: Error | null;
  timestamp: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

const TIER_KEYS: PriorityTier[] = ['critical', 'secondary', 'deferred'];

interface ReactiveState {
  streams: Map<string, StreamBean>;
  activities: {
    [TIER_KEYS[0]]: number;
    [TIER_KEYS[1]]: number;
    [TIER_KEYS[2]]: number;
  };
  currentStage: Stage;
  lastTransitionAt: number | undefined;
  stage1Data: StreamBean | undefined;
  stage2Data: StreamBean | undefined;
  stage3Data: StreamBean | undefined;
  criticalCount: number;
  secondaryCount: number;
  deferredCount: number;
}

export function ProgressiveRevealOrchestrator({
  children,
  callbacks,
}: {
  children: React.ReactNode;
  callbacks?: React.ComponentProps<typeof ProgressiveRevealContext.Provider>['value']['callbacks'];
}) {
  const [state, setState] = useState<ReactiveState>({
    streams: new Map(),
    activities: {
      critical: 0,
      secondary: 0,
      deferred: 0,
    },
    currentStage: 0,
    lastTransitionAt: undefined,
    stage1Data: undefined,
    stage2Data: undefined,
    stage3Data: undefined,
    criticalCount: 0,
    secondaryCount: 0,
    deferredCount: 0,
  });

  const activitiesRef = useRef(state.activities);
  const lastStateRef = useRef(state);

  const getTimeout = (priority: PriorityTier): number => TIMEOUTS[priority] ?? 10000;

  const cleanupStream = (stream: StreamBean) => {
    if (stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
  };

  const register = (key: string, priority: PriorityTier, overrideTimeout?: number) => {
    const existing = state.streams.get(key);
    if (existing) return;

    const timeoutMs = overrideTimeout ?? getTimeout(priority);
    const timeoutHandle = setTimeout(() => {
      const fresh = state.streams.get(key);
      if (!fresh || fresh.resolved) return;
      const err = new Error(`${key} timed out after ${timeoutMs}ms`);
      fail(key, err);
    }, timeoutMs);

    setState(old => ({
      ...old,
      streams: new Map([...old.streams, [key, {
        key,
        priority,
        resolved: false,
        error: null,
        timestamp: performance.now(),
        timeoutHandle,
      }]]),
    }));

    activitiesRef.current = {
      ...activitiesRef.current,
      [priority]: activitiesRef.current[priority] + 1,
    };

    lastStateRef.current = {
      ...lastStateRef.current,
      currentStage: latestStage(state.streams),
      lastTransitionAt: performance.now(),
    };
  };

  const resolve = (key: string, data: unknown) => {
    const fresh = state.streams.get(key);
    if (!fresh || fresh.resolved) return;

    cleanupStream(fresh);

    const resolvedBean: StreamBean = { ...fresh, resolved: true, data, timestamp: performance.now(), timeoutHandle: undefined } as StreamBean;
    setState(old => {
      const next = new Map([...old.streams]);
      next.set(key, resolvedBean);
      return { ...old, streams: next };
    });

    callbacks?.onStreamResolve?.(resolvedBean as unknown as ProgressiveRevealStream);
    activitiesRef.current = {
      ...activitiesRef.current,
      [fresh.priority]: activitiesRef.current[fresh.priority] + 1,
    };

    lastStateRef.current = {
      ...lastStateRef.current,
      currentStage: latestStage(state.streams),
      lastTransitionAt: performance.now(),
    };
  };

  const fail = (key: string, error: Error) => {
    const fresh = state.streams.get(key);
    if (!fresh || fresh.resolved) return;

    cleanupStream(fresh);

    const errBean: StreamBean = { ...fresh, error, timestamp: performance.now(), timeoutHandle: undefined } as StreamBean;
    setState(old => {
      const next = new Map([...old.streams]);
      next.set(key, errBean);
      return { ...old, streams: next };
    });

    callbacks?.onStreamTimeout?.(errBean as unknown as ProgressiveRevealStream);
    lastStateRef.current = {
      ...lastStateRef.current,
      currentStage: latestStage(state.streams),
      lastTransitionAt: performance.now(),
    };
  };

  const reset = (key?: string) => {
    if (key) {
      const stream = state.streams.get(key);
      if (stream && stream.timeoutHandle) clearTimeout(stream.timeoutHandle);
      const next = new Map(state.streams);
      next.delete(key);
      setState(old => ({
        ...old,
        streams: next,
      }));
      activitiesRef.current = {
        ...activitiesRef.current,
        [stream?.priority ?? 'critical' + 'Started']: Math.max(0, activitiesRef.current[stream?.priority ?? 'critical' + 'Started'] - 1),
      };
    } else {
      let timers = 0;
      state.streams.forEach(s => { if(s.timeoutHandle) clearTimeout(s.timeoutHandle); timers++; });
      const zeroActivities = {
        criticalResolved: 0,
        secondaryResolved: 0,
        deferredResolved: 0,
        criticalStarted: 0,
        secondaryStarted: 0,
        deferredStarted: 0,
      };
      setState(old => ({ ...old, streams: new Map(), activities: zeroActivities }));
      activitiesRef.current = zeroActivities;
    }

    const freshPrevious = lastStateRef.current;
    lastStateRef.current = {
      currentStage: latestStage(state.streams),
      lastTransitionAt: freshPrevious.currentStage === lastStateRef.current.currentStage ? freshPrevious.lastTransitionAt : performance.now(),
    };
  };

  const value = useMemo(() => {
    const s = state.streams;
    const stage1 = s.get('critical');
    const stage2 = s.get('secondary');
    const stage3 = s.get('deferred');

    return {
      currentStage: latestStage(s),
      lastTransitionAt: lastStateRef.current.lastTransitionAt,
      streams: s,
      callbacks,
      register,
      resolve,
      fail,
      reset,
      stage1Data: stage1?.data ?? null,
      stage2Data: stage2?.data ?? null,
      stage3Data: stage3?.data ?? null,
      criticalCount: activitiesRef.current.criticalResolved,
      secondaryCount: activitiesRef.current.secondaryResolved,
      deferredCount: activitiesRef.current.deferredResolved,
    };
  }, [state, lastStateRef.current, callbacks, register, resolve, fail, reset]);

  useEffect(() => () => {
    state.streams.forEach(s => { if(s.timeoutHandle) clearTimeout(s.timeoutHandle); });
  }, [state.streams]);

  return (
    <ProgressiveRevealContext.Provider value={value}>
      {children}
    </ProgressiveRevealContext.Provider>
  );
}

function latestStage(streams: Map<string, StreamBean>): Stage {
  let max = 0;
  streams.forEach(s => {
    if (!s.resolved) return;
    switch (s.priority) {
      case 'critical': max = Math.max(max, 1); break;
      case 'secondary': max = Math.max(max, 2); break;
      case 'deferred': max = Math.max(max, 3); break;
    }
  });
  return max;
}

export function useProgressiveReveal(): ProgressiveRevealContextValue {
  const ctx = useContext(ProgressiveRevealContext);
  if (!ctx) throw new Error('useProgressiveReveal must be used within a ProgressiveRevealOrchestrator');
  return ctx;
}