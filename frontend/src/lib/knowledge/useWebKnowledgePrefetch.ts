/**
 * The web chat's knowledge PreFetch (PRD 38 §3.1 "from any host"): THE browser port
 * (`@builderforce/knowledge-browser` `createBrowserKnowledgePrefetchPort`) over the web's
 * knowledge client, handed to each run through `prepareRun`, and the transcript's answer
 * chips routed to the canvas's `knowledge` surface (`knowledgeChipRoute.ts`).
 *
 * No `'use client'` of its own: only ever imported by client components.
 */

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { TimelinePrefetch } from '@seanhogg/builderforce-brain-ui';
import type { BrainRunRequest } from '@seanhogg/builderforce-brain-embedded';
import {
  BROWSER_PREFETCH_CALIBRATION_KEY, createBrowserKnowledgePrefetchPort, localStorageCalibration,
} from '@builderforce/knowledge-browser';
import { usePrefetchLabels } from '@/lib/brain/usePrefetchLabels';
import { createWebKnowledgeClient } from './webKnowledgeClient';
import { webChipHref } from './knowledgeChipRoute';

export interface WebKnowledgePrefetch {
  /** `useBrainConversation`'s `prepareRun`: the run's `prefetch` port when a project is in context. */
  prepareRun: () => Promise<Partial<BrainRunRequest>>;
  /** `<BrainTimeline prefetch>`: the answer rows' copy and their chips' router. */
  timelinePrefetch: TimelinePrefetch;
}

export function useWebKnowledgePrefetch(projectId: number | null): WebKnowledgePrefetch {
  const router = useRouter();
  const { labels, labelOf } = usePrefetchLabels();
  const port = useMemo(() => (projectId == null ? null : createBrowserKnowledgePrefetchPort({
    client: createWebKnowledgeClient(projectId),
    calibration: localStorageCalibration(BROWSER_PREFETCH_CALIBRATION_KEY),
  })), [projectId]);
  const prepareRun = useCallback(async (): Promise<Partial<BrainRunRequest>> => (port ? { prefetch: port } : {}), [port]);
  const timelinePrefetch = useMemo<TimelinePrefetch>(() => ({
    labels,
    labelOf,
    onChip: (chip) => {
      const href = webChipHref(chip, projectId);
      if (href) router.push(href);
    },
  }), [labels, labelOf, projectId, router]);
  return { prepareRun, timelinePrefetch };
}
