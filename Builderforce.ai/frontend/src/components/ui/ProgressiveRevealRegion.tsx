'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useProgressiveReveal } from './ProgressiveRevealContext';
import { ShimmerPrimitive } from './Skeletons';
import type { PriorityTier, Stage } from './types';

/**
 * ProgressiveRevealRegion — the FR-7 component contract wrapper.
 *
 * Every async data region that participates in the progressive-reveal system
 * renders through this component. It:
 *
 *  1. Registers itself with the orchestrator on mount (with priority + timeout).
 *  2. Renders a skeleton at stages 0 / while loading.
 *  3. Renders children at or above the stage matching its priority.
 *  4. Shows an inline error + retry button when its stream fails (FR-5 / AC-8).
 *  5. Supports chunked data via `chunks` from the orchestrator (FR-4).
 *
 * Usage:
 * ```tsx
 * <ProgressiveRevealRegion
 *   streamKey="headline-metric"
 *   priority="critical"
 *   skeleton={<MetricShimmer />}
 * >
 *   <HeadlineMetric value={...} />
 * </ProgressiveRevealRegion>
 * ```
 */
export function ProgressiveRevealRegion({
  streamKey,
  priority,
  timeoutMs,
  skeleton,
  children,
  fallback,
  errorFallback,
}: {
  /** Unique key within this orchestrator scope. */
  streamKey: string;
  priority: PriorityTier;
  timeoutMs?: number;
  /** Skeleton shown during loading (Stage 0 / while stream unresolved). */
  skeleton?: React.ReactNode;
  /** Content shown once data is available. Receives resolved data + chunk array. */
  children?: React.ReactNode | ((data: unknown, chunks: unknown[]) => React.ReactNode);
  /** Optional fallback while loading (overrides skeleton). */
  fallback?: React.ReactNode;
  /** Optional custom error renderer. Receives error + retry callback. */
  errorFallback?: (error: Error, retry: () => void) => React.ReactNode;
}) {
  const orchestrator = useProgressiveReveal();
  const registerId = useId();
  const effectiveKey = streamKey || registerId;

  // Register on mount; clean up on unmount (but keep stream data for the view).
  useEffect(() => {
    orchestrator.register(effectiveKey, priority, timeoutMs);
    // We intentionally do NOT reset on unmount — the stream is per-view,
    // not per-component. Remove this effect's cleanup to avoid blowing away
    // resolved data when a consumer remounts.
  }, [effectiveKey, priority, timeoutMs, orchestrator]);

  const stream = orchestrator.streams.get(effectiveKey);
  const isLoading = !stream || (!stream.resolved && !stream.error);
  const hasError = stream?.error ?? null;
  const hasData = stream?.resolved === true;
  const chunks = stream?.chunks ?? [];

  // Determine if this region should show content based on its priority tier
  const priorityStage: Stage =
    priority === 'critical' ? 1 : priority === 'secondary' ? 2 : 3;

  const stageReached = orchestrator.currentStage >= priorityStage;

  // Retry: clear failed stream so it can be re-registered (AC-8).
  const handleRetry = () => {
    orchestrator.retry(effectiveKey);
  };

  // ---- render decision tree ----

  // Error state (FR-5): independent per-region error boundary
  if (hasError) {
    if (errorFallback) {
      return <>{errorFallback(hasError, handleRetry)}</>;
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 24px',
          gap: 8,
          border: '1px solid var(--border-error, #fca5a5)',
          borderRadius: 'var(--radius-md, 8px)',
          background: 'var(--bg-error-subtle, #fef2f2)',
          color: 'var(--text-error, #b91c1c)',
          minHeight: 120,
        }}
        role="alert"
      >
        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          Failed to load {priority} data.
        </span>
        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
          {hasError.message}
        </span>
        <button
          onClick={handleRetry}
          style={{
            marginTop: 4,
            padding: '6px 16px',
            fontSize: '0.8125rem',
            border: '1px solid currentColor',
            borderRadius: 'var(--radius-sm, 4px)',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Loading state (Stage 0 / stream not yet resolved)
  if (isLoading || !stageReached) {
    if (fallback) return <>{fallback}</>;
    if (skeleton) return <>{skeleton}</>;
    return <ShimmerPrimitive height={80} />;
  }

  // Resolved — render children
  if (typeof children === 'function') {
    return <>{children(stream?.data ?? null, chunks)}</>;
  }

  return <>{children}</>;
}

/**
 * ProgressiveRevealShell — renders immediately at Stage 0 (no data dependency).
 * Use for page chrome, navigation, layout containers. Children render
 * unconditionally; the shell registers a synthetic stream so the orchestrator
 * has a baseline.
 */
export function ProgressiveRevealShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const orchestrator = useProgressiveReveal();
  const id = useId();

  useEffect(() => {
    orchestrator.register(`shell-${id}`, 'critical', 0);
    orchestrator.resolve(`shell-${id}`, null);
  }, [id, orchestrator]);

  return <>{children}</>;
}
