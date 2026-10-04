import type { CanvasVideoSource, CanvasVideoTimeline } from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';

/**
 * THE client for AI video — `/llm/v1/videos/*`.
 *
 * Every video is a JOB on the server: a clip takes from half a minute to a few
 * minutes, so `start…` returns at once with a job id and {@link waitForVideoJob}
 * polls until the job finishes. The gateway picks the model by plan (cheap
 * first; quality models on paid plans), stores the result in the workspace's
 * own storage and hands back a durable URL. The canvas scene panel, the canvas
 * Brain's video tools and the Studio workspace's `generate_video_asset` action
 * all call this; none of them builds a request of its own.
 */

export type VideoAspectRatio = '16:9' | '9:16' | '1:1';
export const VIDEO_ASPECT_RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1'];

export function isVideoAspectRatio(value: unknown): value is VideoAspectRatio {
  return typeof value === 'string' && (VIDEO_ASPECT_RATIOS as readonly string[]).includes(value);
}

export type VideoJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface VideoJob {
  id: string;
  kind: 'clip' | 'render';
  status: VideoJobStatus;
  result?: { url: string; storageKey: string; mimeType: string; durationSeconds: number; model?: string };
  error?: string;
  attempts?: number;
}

export interface VideoClipArgs {
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: VideoAspectRatio;
  /** Optional first frame, e.g. a generated still of the shot. */
  imageUrl?: string;
  useCase: string;
}

export function startVideoClip(args: VideoClipArgs): Promise<VideoJob> {
  return apiRequest<VideoJob>('/llm/v1/videos/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: args.prompt,
      ...(args.durationSeconds ? { duration: args.durationSeconds } : {}),
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
      ...(args.imageUrl ? { image_url: args.imageUrl } : {}),
      useCase: args.useCase,
    }),
  });
}

/** Paid plans: render a video timeline to MP4 on the server (finishes with the tab closed). */
export function startServerMovieRender(args: { timeline: CanvasVideoTimeline; sources: readonly CanvasVideoSource[]; useCase: string }): Promise<VideoJob> {
  return apiRequest<VideoJob>('/llm/v1/videos/renders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeline: args.timeline, sources: args.sources, useCase: args.useCase }),
  });
}

export function getVideoJob(id: string): Promise<VideoJob> {
  return apiRequest<VideoJob>(`/llm/v1/videos/jobs/${encodeURIComponent(id)}`);
}

/** How often a waiting client asks. A clip takes ~30s–3min; this is a status read. */
const POLL_INTERVAL_MS = 5_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Generation aborted', 'AbortError')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Generation aborted', 'AbortError')); }, { once: true });
  });
}

/**
 * Poll a job until it finishes. Resolves with the succeeded job; throws the
 * job's own error message when it failed (that sentence names the real reason).
 * Aborting stops WAITING — the server job carries on and can be read later.
 */
export async function waitForVideoJob(id: string, opts: { signal?: AbortSignal; onUpdate?: (job: VideoJob) => void } = {}): Promise<VideoJob> {
  for (;;) {
    const job = await getVideoJob(id);
    opts.onUpdate?.(job);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new Error(job.error || 'The video could not be generated');
    await sleep(POLL_INTERVAL_MS, opts.signal);
  }
}

/** A finished job as the canvas's stored-media shape (`CanvasVideoSource`). */
export function videoJobSource(job: VideoJob, fileName: string): CanvasVideoSource {
  if (!job.result) throw new Error('The video job has no result');
  return {
    id: job.id,
    kind: 'video',
    captureKind: 'ai',
    url: job.result.url,
    fileName,
    mimeType: job.result.mimeType,
    durationSeconds: job.result.durationSeconds,
    storageKey: job.result.storageKey,
  };
}

/** Start a clip and wait for it: the one-call path for agent tools. */
export async function generateVideoClip(args: VideoClipArgs & { signal?: AbortSignal }): Promise<{ job: VideoJob; source: CanvasVideoSource }> {
  const started = await startVideoClip(args);
  const job = await waitForVideoJob(started.id, { signal: args.signal });
  return { job, source: videoJobSource(job, `${args.prompt.slice(0, 40).trim() || 'clip'}.mp4`) };
}
