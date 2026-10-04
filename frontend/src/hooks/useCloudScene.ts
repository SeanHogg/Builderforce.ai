/**
 * useCloudScene — orchestration for a `scene` object rendered with CLOUD video.
 *
 * A single clip and a planned movie are the same thing here: a scene is a list of
 * shots, and "generate a clip" is a scene of one shot. So there is one render
 * path (`renderSceneShots`), one place a clip lands (`shots[].output`) and one way
 * to turn the result into a movie (`canvasSceneMovie`), whichever button started it.
 *
 * Persistence goes through `onChange` like every other scene field. Per-shot
 * progress arrives in bursts (several shots can finish in one tick), so shot
 * patches apply to a SYNCHRONOUS working copy before they are committed — reading
 * the last committed spec would let two completions overwrite each other.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canvasSceneMovie,
  type CanvasSceneAspect,
  type CanvasSceneShot,
  type CanvasSceneSpec,
  type CanvasVideoSource,
  type CanvasVideoTimeline,
} from '@builderforce/creation-canvas-contract';
import { planCloudScene, snapShotSeconds } from '@/lib/sceneStoryboard';
import { renderSceneShots } from '@/lib/sceneRendering';
import { useLatestRef } from '@/components/creation-canvas/hooks/useLatestRef';

export type CloudSceneActivity = 'idle' | 'planning' | 'rendering';

export interface SceneMovieDraft { title: string; videoTimeline: CanvasVideoTimeline; videoSources: CanvasVideoSource[] }

export interface UseCloudSceneResult {
  shots: CanvasSceneShot[];
  activity: CloudSceneActivity;
  /** The last failure that stopped a whole action (a single shot's failure lives on the shot). */
  error: string | null;
  aspectRatio: CanvasSceneAspect;
  setAspectRatio: (value: CanvasSceneAspect) => void;
  /** One shot of the prompt as written, rendered now. */
  generateClip: (durationSeconds: number) => Promise<void>;
  /** Plan a multi-shot storyboard of about `totalSeconds`, then render it. */
  planScene: (totalSeconds: number) => Promise<void>;
  /** Render every shot that has no clip yet (and resume any still rendering). */
  renderShots: () => Promise<void>;
  editShot: (shotId: string, patch: Pick<Partial<CanvasSceneShot>, 'prompt' | 'durationSeconds'>) => void;
  removeShot: (shotId: string) => void;
  /** The movie draft, or null while nothing is rendered. */
  movie: SceneMovieDraft | null;
  cancel: () => void;
}

export function useCloudScene(
  objectTitle: string,
  spec: CanvasSceneSpec,
  onChange: ((patch: Partial<CanvasSceneSpec>) => void) | undefined,
): UseCloudSceneResult {
  const [activity, setActivity] = useState<CloudSceneActivity>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const specRef = useLatestRef(spec);
  /** The working copy shot patches apply to — see the module header. */
  const shotsRef = useRef<CanvasSceneShot[]>(spec.shots ?? []);
  // While nothing runs, the committed spec is the truth (another editor, an undo).
  useEffect(() => {
    if (activity === 'idle') shotsRef.current = spec.shots ?? [];
  }, [activity, spec.shots]);
  const aspectRatio = spec.aspectRatio ?? '16:9';

  const commitShots = useCallback((shots: CanvasSceneShot[]) => {
    shotsRef.current = shots;
    onChange?.({ shots });
  }, [onChange]);

  const patchShot = useCallback((shotId: string, patch: Partial<CanvasSceneShot>) => {
    commitShots(shotsRef.current.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)));
  }, [commitShots]);

  const run = useCallback(async (next: CloudSceneActivity, body: (signal: AbortSignal) => Promise<void>) => {
    if (!onChange) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setActivity(next);
    try {
      await body(abort.signal);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      abortRef.current = null;
      setActivity('idle');
    }
  }, [onChange]);

  const renderPending = useCallback(async (signal: AbortSignal) => {
    const pending = shotsRef.current.filter((shot) => !shot.output);
    if (pending.length === 0) return;
    await renderSceneShots(pending, { aspectRatio: specRef.current.aspectRatio ?? '16:9', useCase: 'canvas_scene_shot', signal, onShot: patchShot });
  }, [patchShot, specRef]);

  const generateClip = useCallback((durationSeconds: number) => run('rendering', async (signal) => {
    const prompt = specRef.current.prompt.trim();
    if (!prompt) return;
    const shots: CanvasSceneShot[] = [{ id: 'shot-1', action: prompt.slice(0, 80), prompt, camera: 'static', durationSeconds: snapShotSeconds(durationSeconds), status: 'pending' }];
    shotsRef.current = shots;
    onChange?.({ storyboard: undefined, shots });
    await renderPending(signal);
  }), [onChange, renderPending, run, specRef]);

  const planScene = useCallback((totalSeconds: number) => run('planning', async (signal) => {
    const prompt = specRef.current.prompt.trim();
    if (!prompt) return;
    const planned = await planCloudScene({ request: prompt, totalSeconds, signal });
    shotsRef.current = planned.shots;
    onChange?.({ storyboard: planned.storyboard, shots: planned.shots });
    setActivity('rendering');
    await renderPending(signal);
  }), [onChange, renderPending, run, specRef]);

  const renderShots = useCallback(() => run('rendering', renderPending), [renderPending, run]);

  const editShot = useCallback((shotId: string, patch: Pick<Partial<CanvasSceneShot>, 'prompt' | 'durationSeconds'>) => {
    // A changed shot is a different clip: drop the old one so the next render redoes it.
    patchShot(shotId, { ...patch, status: 'pending', output: undefined, error: undefined, jobId: undefined });
  }, [patchShot]);

  const removeShot = useCallback((shotId: string) => {
    commitShots(shotsRef.current.filter((shot) => shot.id !== shotId));
  }, [commitShots]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  // A reload mid-render leaves shots `rendering` with a job id. Pick them back up
  // (the server kept working) instead of leaving them spinning forever.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !onChange) return;
    if (!(spec.shots ?? []).some((shot) => shot.status === 'rendering' && shot.jobId)) return;
    resumed.current = true;
    void run('rendering', async (signal) => {
      const inFlight = shotsRef.current.filter((shot) => shot.status === 'rendering' && shot.jobId);
      await renderSceneShots(inFlight, { aspectRatio: specRef.current.aspectRatio ?? '16:9', useCase: 'canvas_scene_shot', signal, onShot: patchShot });
    });
  }, [onChange, patchShot, run, spec.shots, specRef]);

  // Abandon waiting (never the server jobs) when the panel closes.
  useEffect(() => () => abortRef.current?.abort(), []);

  const built = canvasSceneMovie(spec);
  return {
    shots: spec.shots ?? [],
    activity,
    error,
    aspectRatio,
    setAspectRatio: (value) => onChange?.({ aspectRatio: value }),
    generateClip,
    planScene,
    renderShots,
    editShot,
    removeShot,
    movie: built ? { title: objectTitle, videoTimeline: built.timeline, videoSources: built.sources } : null,
    cancel,
  };
}
