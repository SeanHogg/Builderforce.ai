/**
 * useServerMovieRender — render a canvas video timeline to MP4 on the SERVER.
 *
 * The browser export renders in the tab; this hands the timeline to the render
 * container and follows the job. The job id is persisted by the caller (on the
 * `video` object), so the render survives the tab closing: whoever opens the
 * object next picks the job back up and lands its result.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CanvasVideoSource, CanvasVideoTimeline } from '@builderforce/creation-canvas-contract';
import { startServerMovieRender, waitForVideoJob, type VideoJob } from '@/lib/videoGenerationApi';
import { useLatestRef } from '@/components/creation-canvas/hooks/useLatestRef';

export type ServerMovieRendition = NonNullable<VideoJob['result']>;
export type ServerMovieRenderPhase = 'idle' | 'starting' | 'rendering' | 'failed';

export interface UseServerMovieRenderOptions {
  /** The job already running for this movie (persisted on the object), or null. */
  pendingJobId: string | null;
  /** Persist a started job's id — or null once it has settled. */
  onJobChange: (jobId: string | null) => void;
  /** The finished MP4, already in the workspace's storage. */
  onRendered: (rendition: ServerMovieRendition) => void;
}

export interface UseServerMovieRenderResult {
  phase: ServerMovieRenderPhase;
  error: string | null;
  start: (timeline: CanvasVideoTimeline, sources: readonly CanvasVideoSource[]) => Promise<void>;
}

export function useServerMovieRender({ pendingJobId, onJobChange, onRendered }: UseServerMovieRenderOptions): UseServerMovieRenderResult {
  const [phase, setPhase] = useState<ServerMovieRenderPhase>(pendingJobId ? 'rendering' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const callbacks = useLatestRef({ onJobChange, onRendered });

  // Follow whichever job is pending — the one this tab started, or one a previous
  // visit left running. Leaving stops WAITING; the server job carries on.
  useEffect(() => {
    if (!pendingJobId) return;
    const controller = new AbortController();
    setPhase('rendering');
    setError(null);
    waitForVideoJob(pendingJobId, { signal: controller.signal })
      .then((job) => {
        if (job.result) callbacks.current.onRendered(job.result);
        callbacks.current.onJobChange(null);
        setPhase('idle');
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setPhase('failed');
        callbacks.current.onJobChange(null);
      });
    return () => controller.abort();
  }, [pendingJobId, callbacks]);

  const start = useCallback(async (timeline: CanvasVideoTimeline, sources: readonly CanvasVideoSource[]) => {
    setPhase('starting');
    setError(null);
    try {
      const job = await startServerMovieRender({ timeline, sources, useCase: 'canvas-movie-render' });
      callbacks.current.onJobChange(job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('failed');
    }
  }, [callbacks]);

  return { phase, error, start };
}
