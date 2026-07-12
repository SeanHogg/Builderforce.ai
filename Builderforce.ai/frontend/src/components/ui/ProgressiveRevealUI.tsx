'use client';

import { useProgressiveReveal } from './ProgressiveRevealContext';
import { useState, useEffect, useCallback } from 'react';

/** Client-side hook that implements command-line UI with progressive reveals */
export function useProgressiveRevealUI() {
  const { currentStage, stage1Data, stage2Data, stage3Data, criticalCount, secondaryCount, deferredCount } = useProgressiveReveal();

  /** Translates stage number to human-friendly label */
  const stageLabel = (() => {
    switch (currentStage) {
      case 0: return 'Initializing shell';
      case 1: return 'Critical content loaded';
      case 2: return 'Secondary details available';
      case 3: return 'Full content revealed';
      default: return 'Loading...';
    }
  })();

  /** Track whether at least one critical stream is done (approximate for UX) */
  const criticalComplete = currentStage >= 1;

  return {
    stage: currentStage,
    label: stageLabel,
    isVisibleAlways: true,
    // Data slices:
    criticalLayer: stage1Data,
    secondaryLayer: stage2Data,
    tertiaryLayer: stage3Data,
    // Observability counters:
    metrics: {
      criticalLoaded: criticalCount,
      secondaryLoaded: secondaryCount,
      tertiaryLoaded: deferredCount,
    },
    // Persistence:
    autoPersist: true,
    storageKey: 'codeli_progressive_state',
  };
}

/** Placeholder props for stage gating and behavior flags */
export interface StageGatingProps {
  minStage?: number;
  hideOnNoData?: boolean;
  skeleton?: React.ReactNode;
  fallback?: React.ReactNode;
}

export function useStageGating({ minStage = 1, hideOnNoData = true, skeleton, fallback }: StageGatingProps = {}) {
  return useCallback((stage: number): boolean => {
    if (hideOnNoData && !skeleton) {
      return true; // Don't gate if there's no skeleton fallback for “no data” visibility
    }
    return stage >= minStage;
  }, [minStage, hideOnNoData, skeleton]);
}

export function useBadgeFormat({ showCounts = true, showLayerLabels = true }: { showCounts?: boolean; showLayerLabels?: boolean } = {}) {
  return useCallback((layer: number, count: number, label: string): string => {
    const parts: string[] = [];
    if (showLayerLabels) parts.push(label);
    if (showCounts) parts.push(`[${count}]`);
    return parts.join(' ');
  }, [showCounts, showLayerLabels]);
}

export interface EventLoggerConfig {
  app?: 'Builderforce.ai';
  version?: string;
  context?: Record<string, unknown>;
}

export const useEventLogger = (config: EventLoggerConfig = {}) => {
  return useCallback((eventName: string, properties: Record<string, unknown> = {}) => {
    const jsLogger = config.context?.logger;
    if (typeof (jsLogger as any)?.emit === 'function') {
      const payload: Record<string, unknown> = {
        timestamp: Date.now(),
        event: eventName,
        ...properties,
      };
      (jsLogger as any).emit(payload);
    }
  }, [config]);
};