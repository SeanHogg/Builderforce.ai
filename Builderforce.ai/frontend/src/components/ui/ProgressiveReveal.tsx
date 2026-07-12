'use client';

import React, { Suspense, cloneElement, Children } from 'react';
import { ProgressiveRevealContext } from './ProgressiveRevealContext';

type ProgressiveRevealProps = {
  /**
   * The current resolved stage (0–3, auto-managed by orchestrator).
   */
  stage: 0 | 1 | 2 | 3;
  /**
   * Priority tier for new streams being registered here.
   */
  priority: 'critical' | 'secondary' | 'deferred';
  children?: React.ReactNode;
};

/**
 * ProgressiveReveal — wrapper component that ties asynchronous data fetching to the orchestrator.
 * Used as the authoritative progress gate for a view — data streams register through this component.
 */
export function ProgressiveReveal({
  stage,
  priority,
  children,
}: ProgressiveRevealProps) {
  const { register, resolve, fail } = ProgressiveRevealContext.useContext();

  // Register any children that are registered fetchers
  React.useEffect(() => {
    if (!children) return;
    const fetchers = Children.toArray(children).filter(
      (child): child is React.ReactElement<{ priority: 'critical' | 'secondary' | 'deferred' }> =>
        React.isValidElement(child) && child.type === ProgressiveRevealFetcher,
    );

    fetchers.forEach(({ props }) => register(props.priority === 'critical' ? 'critical' : props.priority === 'secondary' ? 'secondary' : 'deferred'));
  }, [children, register]);

  return <ProgressiveRevealContext.Provider value={{ ...ProgressiveRevealContext.useContext(), stage, priority }}>{children}</ProgressiveRevealContext.Provider>;
}

type ProgressiveRevealFetcherProps<T> = {
  priority: 'critical' | 'secondary' | 'deferred';
  timeoutMs?: number;
  children: (data: T | null, loading: boolean, error: Error | null) => React.ReactNode;
  fetch: (timeout: () => Promise<T>) => Promise<T>;
};

/**
 * ProgressiveRevealFetcher — single reactive data stream for progressive reveal.
 * Call fetch once; the orchestrator resolves or times it out and passes the result to children.
 */
export function ProgressiveRevealFetcher<T>({
  priority,
  timeoutMs,
  children,
  fetch,
}: ProgressiveRevealFetcherProps<T>) {
  const ctx = ProgressiveRevealContext.useContext();
  const { currentStage, resolve, fail, streams } = ctx;
  const key = ctx.priority === 'critical' ? 'critical' : ctx.priority === 'secondary' ? 'secondary' : 'deferred';
  const stream = streams.get(key);
  const resolved = !!(stream?.resolved && stream.data !== null);
  const error = stream?.error ?? null;

  React.useEffect(() => {
    if (resolved || !stream) return;
    // Stream is pending; trigger fetch.
    const timeoutId = setTimeout(() => {
      fetch(() => new Promise<void>((resolve) => setTimeout(resolve, 500))) // mock fail-after-timeout
        .then((data) => resolve(key, data))
        .catch((err) => fail(key, err));
    }, 0); // immediate fetch for demo
    return () => clearTimeout(timeoutId);
  }, [resolved, stream, key, resolve, fail, fetch]);

  return children(stream?.resolved ? stream.data : null, resolved, error);
}

/**
 * ProgressiveRevealWrapper — optional higher-order component to expose resolved data for view-level orchestration.
 */
type WrapperChildren<T1, T2 = T1, T3 = T1 | T2> = (
  data1: T1 | null,
  data2: T2 | null,
  data3: T3 | null,
) => React.ReactNode;

type ProgressiveRevealWrapperProps<T1, T2, T3> = {
  primaryFetcher: ProgressiveRevealFetcherProps<T1>['fetch'];
  secondaryFetcher?: ProgressiveRevealFetcherProps<T2>['fetch'];
  tertiaryFetcher?: ProgressiveRevealFetcherProps<T3>['fetch'];
  children: WrapperChildren<T1, T2, T3>;
};

/**
 * ProgressiveRevealWrapper — a composition primitive (e.g., stage1/2/3 hooks or explicit merged data) for multi-stream orchestration.
 */
export function ProgressiveRevealWrapper<T1, T2 = T1, T3 = T1 | T2>({
  primaryFetcher,
  secondaryFetcher,
  tertiaryFetcher,
  children,
}: ProgressiveRevealWrapperProps<T1, T2, T3>) {
  const ctx = ProgressiveRevealContext.useContext();

  const stage1 = React.useMemo(
    () => (ctx.currentStage >= 1 ? ctx.stage1Data ?? null : null),
    [ctx.currentStage, ctx.stage1Data],
  );
  const stage2 = React.useMemo(
    () => (ctx.currentStage >= 2 ? ctx.stage2Data ?? null : null),
    [ctx.currentStage, ctx.stage2Data],
  );
  const stage3 = React.useMemo(
    () => (ctx.currentStage >= 3 ? ctx.stage3Data ?? null : null),
    [ctx.currentStage, ctx.stage3Data],
  );

  return children(stage1, stage2, stage3);
}