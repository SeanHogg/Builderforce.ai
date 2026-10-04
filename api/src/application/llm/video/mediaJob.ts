/**
 * The media job state machine — one generated clip, or one server-rendered movie.
 *
 * A job is advanced one STEP at a time by `advanceMediaJob`, which returns the
 * next state and how long to wait before the next step (null = finished). The
 * Durable Object that owns a job (`infrastructure/relay/MediaJobDO.ts`) only
 * persists the state and schedules its alarm; every decision lives here, behind
 * injected dependencies, so the whole cascade is unit-testable without a DO, a
 * vendor or R2.
 *
 * Clip cascade: walk the plan's model chain; skip a model whose vendor has no
 * key; a retryable failure (rate limit, outage, spent balance, empty answer)
 * moves to the next model; a fatal one (the prompt itself was refused) ends
 * the job, because every other vendor would refuse it too. An async vendor
 * (Veo) parks a `pending` handle and is polled on later steps.
 */

import { VendorFatalError, VendorRetryableError, type VideoClipRequest } from '../videoVendors/types';
import { VIDEO_REGISTRY, videoSecondsFor } from '../videoVendors/registry';
import type { VideoVendorEnv } from '../videoVendors/types';

export type MediaJobKind = 'clip' | 'render';
export type MediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** One placed item of a server-rendered movie — the timeline already resolved
 *  to fetchable URLs (see `movieRenderRequest.ts`). */
export interface MovieRenderItem {
  url: string;
  kind: 'video' | 'image' | 'audio';
  track: 'visual' | 'music' | 'voiceover' | 'sfx';
  startSeconds: number;
  durationSeconds: number;
  trimStartSeconds: number;
  volume: number;
  captions?: string;
}

export interface MovieRenderRequest {
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  items: MovieRenderItem[];
}

export interface MediaJobAttempt { model: string; status: number; error: string }

export interface ClipJobState {
  request: VideoClipRequest;
  /** Prefixed model ids, walked in order. */
  chain: string[];
  index: number;
  pending: { model: string; handle: string } | null;
  attempts: MediaJobAttempt[];
}

export interface MediaJobResult {
  url: string;
  storageKey: string;
  mimeType: string;
  durationSeconds: number;
  model?: string;
}

export interface MediaJobState {
  id: string;
  kind: MediaJobKind;
  tenantId: number;
  userId: string | null;
  /** `llm_product` label the job bills under (clips only). */
  product: string;
  useCase: string | null;
  status: MediaJobStatus;
  createdAt: number;
  updatedAt: number;
  clip?: ClipJobState;
  render?: MovieRenderRequest;
  result?: MediaJobResult;
  error?: string;
}

export interface StoredMedia { url: string; storageKey: string }

export interface MediaJobDeps {
  vendorEnv: VideoVendorEnv;
  now(): number;
  storeMedia(bytes: ArrayBuffer, mimeType: string, fileName: string): Promise<StoredMedia>;
  /** Bill a finished clip (one usage row). */
  recordClipUsage(job: MediaJobState, model: string, seconds: number): Promise<void>;
  /** Cool a model that just failed, so the next job skips it. Advisory. */
  recordFailure(model: string, status: number): Promise<void>;
  /** Models currently cooled by recent failures (prefixed ids). */
  cooledModels(chain: readonly string[]): Promise<ReadonlySet<string>>;
  renderMovie(request: MovieRenderRequest): Promise<{ bytes: ArrayBuffer; mimeType: string }>;
}

export interface MediaJobStep {
  state: MediaJobState;
  /** Milliseconds until the next step, or null when the job is finished. */
  nextStepInMs: number | null;
}

/** A job that has not finished within this long is failed rather than left polling. */
export const MEDIA_JOB_DEADLINE_MS = 20 * 60_000;

/** What a client may see — no tenant ids, no vendor handles. */
export interface MediaJobView {
  id: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  result?: MediaJobResult;
  error?: string;
  attempts?: number;
  createdAt: string;
  updatedAt: string;
}

export function mediaJobView(job: MediaJobState): MediaJobView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.clip ? { attempts: job.clip.attempts.length } : {}),
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  };
}

export function newClipJob(args: {
  id: string; tenantId: number; userId: string | null; product: string; useCase: string | null;
  request: VideoClipRequest; chain: string[]; now: number;
}): MediaJobState {
  return {
    id: args.id, kind: 'clip', tenantId: args.tenantId, userId: args.userId,
    product: args.product, useCase: args.useCase, status: 'queued',
    createdAt: args.now, updatedAt: args.now,
    clip: { request: args.request, chain: args.chain, index: 0, pending: null, attempts: [] },
  };
}

export function newRenderJob(args: {
  id: string; tenantId: number; userId: string | null; useCase: string | null; request: MovieRenderRequest; now: number;
}): MediaJobState {
  return {
    id: args.id, kind: 'render', tenantId: args.tenantId, userId: args.userId,
    product: '', useCase: args.useCase, status: 'queued',
    createdAt: args.now, updatedAt: args.now, render: args.request,
  };
}

const finished = (state: MediaJobState): MediaJobStep => ({ state, nextStepInMs: null });

function fail(state: MediaJobState, error: string, now: number): MediaJobStep {
  return finished({ ...state, status: 'failed', error, updatedAt: now });
}

export async function advanceMediaJob(job: MediaJobState, deps: MediaJobDeps): Promise<MediaJobStep> {
  if (job.status === 'succeeded' || job.status === 'failed') return finished(job);
  const now = deps.now();
  if (now - job.createdAt > MEDIA_JOB_DEADLINE_MS) return fail(job, 'The video took too long to generate. Try again, or try a shorter clip.', now);
  const running: MediaJobState = { ...job, status: 'running', updatedAt: now };
  return running.kind === 'render' ? advanceRender(running, deps) : advanceClip(running, deps);
}

async function advanceRender(job: MediaJobState, deps: MediaJobDeps): Promise<MediaJobStep> {
  if (!job.render) return fail(job, 'Render job has no timeline', deps.now());
  try {
    const { bytes, mimeType } = await deps.renderMovie(job.render);
    const stored = await deps.storeMedia(bytes, mimeType, 'movie.mp4');
    const durationSeconds = job.render.items.reduce((end, item) => Math.max(end, item.startSeconds + item.durationSeconds), 0);
    return finished({ ...job, status: 'succeeded', updatedAt: deps.now(), result: { ...stored, mimeType, durationSeconds } });
  } catch (error) {
    return fail(job, `The movie could not be rendered: ${error instanceof Error ? error.message : String(error)}`, deps.now());
  }
}

async function advanceClip(job: MediaJobState, deps: MediaJobDeps): Promise<MediaJobStep> {
  const clip = job.clip;
  if (!clip) return fail(job, 'Clip job has no request', deps.now());

  // A parked async operation: poll it.
  if (clip.pending) {
    const { model, handle } = clip.pending;
    const { vendorId, vendorModel } = VIDEO_REGISTRY.resolve(model);
    const apiKey = VIDEO_REGISTRY.module(vendorId).apiKeyFrom(deps.vendorEnv);
    if (!apiKey) return nextModel(job, deps, model, 0, `${vendorId} key is no longer configured`);
    try {
      const step = await VIDEO_REGISTRY.module(vendorId).poll({ apiKey, model: vendorModel, handle });
      if (step.kind === 'pending') return { state: job, nextStepInMs: step.retryAfterMs };
      return finishClip(job, deps, model, step.bytes, step.mimeType);
    } catch (error) {
      return onClipError(job, deps, model, error);
    }
  }

  // Pick the next model that has a key and is not cooled.
  const cooled = await deps.cooledModels(clip.chain.slice(clip.index));
  let index = clip.index;
  while (index < clip.chain.length) {
    const model = clip.chain[index]!;
    if (VIDEO_REGISTRY.keyBound(deps.vendorEnv, VIDEO_REGISTRY.vendorFor(model)) && !cooled.has(model)) break;
    index++;
  }
  if (index >= clip.chain.length) {
    const tried = clip.attempts.map((a) => `${a.model} (${a.status})`).join(', ');
    return fail({ ...job, clip: { ...clip, index } }, tried
      ? `Every video model failed: ${tried}.`
      : 'No video model is available right now. Try again shortly.', deps.now());
  }

  const model = clip.chain[index]!;
  const { vendorId, vendorModel } = VIDEO_REGISTRY.resolve(model);
  const mod = VIDEO_REGISTRY.module(vendorId);
  const atIndex: MediaJobState = { ...job, clip: { ...clip, index } };
  try {
    const step = await mod.start({
      ...clip.request,
      durationSeconds: videoSecondsFor(model, clip.request.durationSeconds),
      apiKey: mod.apiKeyFrom(deps.vendorEnv)!,
      model: vendorModel,
    });
    if (step.kind === 'pending') {
      return { state: { ...atIndex, clip: { ...atIndex.clip!, pending: { model, handle: step.handle } } }, nextStepInMs: step.retryAfterMs };
    }
    return finishClip(atIndex, deps, model, step.bytes, step.mimeType);
  } catch (error) {
    return onClipError(atIndex, deps, model, error);
  }
}

async function finishClip(job: MediaJobState, deps: MediaJobDeps, model: string, bytes: ArrayBuffer, mimeType: string): Promise<MediaJobStep> {
  const seconds = videoSecondsFor(model, job.clip!.request.durationSeconds);
  const stored = await deps.storeMedia(bytes, mimeType, 'clip.mp4');
  await deps.recordClipUsage(job, model, seconds);
  return finished({
    ...job,
    status: 'succeeded',
    updatedAt: deps.now(),
    clip: { ...job.clip!, pending: null },
    result: { ...stored, mimeType, durationSeconds: seconds, model },
  });
}

async function onClipError(job: MediaJobState, deps: MediaJobDeps, model: string, error: unknown): Promise<MediaJobStep> {
  if (error instanceof VendorRetryableError) {
    await deps.recordFailure(model, error.status).catch(() => undefined);
    return nextModel(job, deps, model, error.status, error.message);
  }
  if (error instanceof VendorFatalError) {
    return fail(job, `The video was refused: ${error.message.slice(0, 240)}`, deps.now());
  }
  // A network-level throw that escaped classification is treated as retryable.
  return nextModel(job, deps, model, 0, error instanceof Error ? error.message : String(error));
}

/** Record the failed attempt and step past it; the next step runs immediately. */
function nextModel(job: MediaJobState, deps: MediaJobDeps, model: string, status: number, error: string): MediaJobStep {
  const clip = job.clip!;
  return {
    state: {
      ...job,
      updatedAt: deps.now(),
      clip: { ...clip, index: clip.index + 1, pending: null, attempts: [...clip.attempts, { model, status, error: error.slice(0, 240) }] },
    },
    nextStepInMs: 0,
  };
}
