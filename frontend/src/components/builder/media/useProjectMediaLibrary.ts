// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useCallback, useEffect, useRef, useState } from 'react';
import { generateImage } from '@/lib/imageGenerationApi';
import { startVideoClip, waitForVideoJob, type VideoJob } from '@/lib/videoGenerationApi';
import { projectMediaApi, type NewProjectMedia, type ProjectMediaItem, type ProjectMediaPatch } from '@/lib/projectMediaApi';
import { reportBackgroundFailure } from '@/lib/reportError';
import { useLatestRef } from '@/components/creation-canvas/hooks/useLatestRef';
import { imageDimensionsFor, imageSizeFor, videoAspectFor, type MediaRequest } from './mediaRequest';

/**
 * A project's media library: what was generated for it, newest first, plus the
 * ONE way to generate into it — used by the Media panel's own form and by the
 * agent's image/video tools alike.
 *
 * A durable project persists every item (`projectMediaApi`); a workspace held in
 * this browser keeps them for the session only. A video is recorded the moment
 * its job starts, as `rendering`, so a reload finds the card and RESUMES the job
 * rather than losing a clip that is still being paid for.
 */

export interface ProjectMediaLibrary {
  items: ProjectMediaItem[];
  loading: boolean;
  error: string | null;
  /** Generate into the library. Resolves with the finished item; throws the gateway's reason. */
  generate: (request: MediaRequest) => Promise<ProjectMediaItem>;
  markUsed: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const USE_CASE = 'studio_media';

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function localItem(media: NewProjectMedia): ProjectMediaItem {
  return {
    id: `local-${crypto.randomUUID()}`,
    url: null, storageKey: null, mimeType: null, width: null, height: null, durationSeconds: null,
    model: null, jobId: null, error: null, usedAt: null,
    ...media,
    createdAt: new Date().toISOString(),
  };
}

function finishedVideo(job: VideoJob): ProjectMediaPatch {
  return {
    status: 'ready',
    url: job.result?.url ?? null,
    storageKey: job.result?.storageKey ?? null,
    mimeType: job.result?.mimeType ?? 'video/mp4',
    durationSeconds: job.result?.durationSeconds ?? null,
    model: job.result?.model ?? null,
    jobId: null,
  };
}

export function useProjectMediaLibrary(projectId: number | null): ProjectMediaLibrary {
  const [items, setItems] = useState<ProjectMediaItem[]>([]);
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<string | null>(null);
  const following = useRef(new Set<string>());
  // Read at call time: the agent's tool holds this library across renders.
  const itemsRef = useLatestRef(items);

  const upsert = useCallback((item: ProjectMediaItem) => {
    setItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  const record = useCallback(async (media: NewProjectMedia): Promise<ProjectMediaItem> => {
    const item = projectId === null ? localItem(media) : await projectMediaApi.record(projectId, media);
    upsert(item);
    return item;
  }, [projectId, upsert]);

  const patch = useCallback(async (item: ProjectMediaItem, change: ProjectMediaPatch): Promise<ProjectMediaItem> => {
    const next = projectId === null || item.id.startsWith('local-')
      ? { ...item, ...change, ...(change.used ? { usedAt: new Date().toISOString() } : {}) }
      : await projectMediaApi.update(projectId, item.id, change);
    upsert(next as ProjectMediaItem);
    return next as ProjectMediaItem;
  }, [projectId, upsert]);

  /** Wait for a recorded video's job and land its result on the item. */
  const follow = useCallback(async (item: ProjectMediaItem): Promise<ProjectMediaItem> => {
    if (!item.jobId) return item;
    following.current.add(item.id);
    try {
      const job = await waitForVideoJob(item.jobId);
      return await patch(item, finishedVideo(job));
    } catch (caught) {
      const failed = await patch(item, { status: 'failed', jobId: null, error: errorText(caught, 'The video could not be generated') });
      throw new Error(failed.error ?? 'The video could not be generated');
    } finally {
      following.current.delete(item.id);
    }
  }, [patch]);

  // Load the library, and pick back up any video still rendering from an earlier visit.
  useEffect(() => {
    if (projectId === null) return;
    let live = true;
    void projectMediaApi.list(projectId)
      .then((media) => {
        if (!live) return;
        setItems(media);
        for (const item of media) {
          if (item.status === 'rendering' && item.jobId && !following.current.has(item.id)) {
            // A failed resume already marks the card failed; the report is for the record.
            void follow(item).catch((caught: unknown) => {
              void reportBackgroundFailure({ message: errorText(caught, 'Resuming a video job failed'), level: 'warning', context: { mediaId: item.id } });
            });
          }
        }
      })
      .catch((caught: unknown) => { if (live) setError(errorText(caught, 'The media library could not be loaded')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId, follow]);

  const generate = useCallback(async (request: MediaRequest): Promise<ProjectMediaItem> => {
    setError(null);
    if (request.kind === 'image') {
      const image = await generateImage({ prompt: request.prompt, size: imageSizeFor(request.shape), useCase: USE_CASE });
      return record({
        kind: 'image', status: 'ready', prompt: request.prompt, url: image.url,
        model: image.model ?? null, ...imageDimensionsFor(request.shape),
      });
    }
    const job = await startVideoClip({ prompt: request.prompt, durationSeconds: request.durationSeconds, aspectRatio: videoAspectFor(request.shape), useCase: USE_CASE });
    const rendering = await record({ kind: 'video', status: 'rendering', prompt: request.prompt, jobId: job.id, durationSeconds: request.durationSeconds });
    return follow(rendering);
  }, [record, follow]);

  const markUsed = useCallback(async (id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (item && !item.usedAt) await patch(item, { used: true });
  }, [itemsRef, patch]);

  const remove = useCallback(async (id: string) => {
    if (projectId !== null && !id.startsWith('local-')) await projectMediaApi.remove(projectId, id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, [projectId]);

  return { items, loading, error, generate, markUsed, remove };
}
