import type { CanvasSceneAspect, CanvasSceneShot } from '@builderforce/creation-canvas-contract';
import { startVideoClip, videoJobSource, waitForVideoJob } from './videoGenerationApi';
import { toolErrorMessage } from './toolErrorMessage';

/**
 * Render a scene's shots as cloud clips — the ONE implementation behind the
 * scene panel's "Render shots" and the canvas Brain's scene/movie tools.
 *
 * Each shot is its own server job, so shots render in parallel (bounded, to be
 * a polite tenant of the vendor) and a shot that fails does not stop the rest.
 * A shot already `rendering` with a `jobId` — the page reloaded mid-render — is
 * RESUMED by polling its existing job instead of paying for a second clip.
 *
 * Progress is reported per shot through `onShot(shotId, patch)`; the caller owns
 * persisting it, so this module never touches a canvas object.
 */

export interface SceneShotRenderOptions {
  aspectRatio: CanvasSceneAspect;
  useCase: string;
  signal?: AbortSignal;
  /** Shots rendered at once. */
  concurrency?: number;
  onShot: (shotId: string, patch: Partial<CanvasSceneShot>) => void;
}

export interface SceneShotRenderSummary { done: number; failed: number }

async function renderOne(shot: CanvasSceneShot, opts: SceneShotRenderOptions): Promise<boolean> {
  try {
    let jobId = shot.status === 'rendering' ? shot.jobId : undefined;
    if (!jobId) {
      const started = await startVideoClip({
        prompt: shot.prompt,
        durationSeconds: shot.durationSeconds,
        aspectRatio: opts.aspectRatio,
        useCase: opts.useCase,
      });
      jobId = started.id;
      opts.onShot(shot.id, { status: 'rendering', jobId, error: undefined });
    }
    const job = await waitForVideoJob(jobId, opts.signal ? { signal: opts.signal } : {});
    opts.onShot(shot.id, { status: 'done', output: videoJobSource(job, `${shot.id}.mp4`), jobId: undefined, error: undefined });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    opts.onShot(shot.id, { status: 'failed', jobId: undefined, error: toolErrorMessage(error, 'The shot could not be rendered') });
    return false;
  }
}

/** Render (or resume) every shot that has no clip yet. */
export async function renderSceneShots(shots: readonly CanvasSceneShot[], opts: SceneShotRenderOptions): Promise<SceneShotRenderSummary> {
  const queue = shots.filter((shot) => !shot.output);
  const summary: SceneShotRenderSummary = { done: 0, failed: 0 };
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, queue.length)) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (await renderOne(next, opts)) summary.done++; else summary.failed++;
    }
  });
  await Promise.all(workers);
  return summary;
}
