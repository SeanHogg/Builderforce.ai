import type { CanvasSceneShot } from '@builderforce/creation-canvas-contract';
import type { Storyboard } from '@seanhogg/builderforce-studio';
import { getStoredTenantToken } from './auth';
import { getApiBaseUrl } from './apiClient';

/**
 * Storyboards for CLOUD scenes — the studio's own two-pass planner (director →
 * shot planner), sized in SECONDS rather than frames.
 *
 * `planScene` distributes a frame budget across its shots; a cloud clip is
 * measured in seconds, so the budget passed in is the movie's length in seconds
 * and each shot's `durationFrames` comes back as its seconds. Each shot is then
 * snapped to a length the video models actually render.
 */

/** Clip lengths the cloud video models render (union of every model's options). */
export const CLOUD_SHOT_SECONDS = [4, 5, 6, 8, 10] as const;

/** Longest movie a single scene plans, in seconds. */
export const MAX_SCENE_SECONDS = 60;

export function snapShotSeconds(seconds: number): number {
  const wanted = Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
  return CLOUD_SHOT_SECONDS.reduce((best, d) => (Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best), 5);
}

/**
 * Turn a storyboard into the scene's shot list. A shot whose id AND prompt are
 * unchanged keeps the clip it already rendered, so editing one shot of a
 * storyboard re-renders that shot only.
 */
export function shotsFromStoryboard(
  storyboard: Storyboard,
  composePrompt: (shot: Storyboard['shots'][number], characters: Storyboard['characters']) => string,
  previous: readonly CanvasSceneShot[] = [],
): CanvasSceneShot[] {
  const prior = new Map(previous.map((shot) => [shot.id, shot]));
  return storyboard.shots.map((planned): CanvasSceneShot => {
    const prompt = composePrompt(planned, storyboard.characters);
    const durationSeconds = snapShotSeconds(planned.durationFrames);
    const kept = prior.get(planned.id);
    if (kept && kept.prompt === prompt && kept.durationSeconds === durationSeconds && kept.output) return { ...kept, action: planned.action, camera: planned.camera };
    return { id: planned.id, action: planned.action, prompt, camera: planned.camera, durationSeconds, status: 'pending' };
  });
}

/** Plan a scene of roughly `totalSeconds` with the studio planner. */
export async function planCloudScene(args: { request: string; totalSeconds: number; signal?: AbortSignal }): Promise<{ storyboard: Storyboard; shots: CanvasSceneShot[] }> {
  // Lazy: the planner module is small, but it lives in the studio package
  // whose engine half must never land in a board that does not plan a scene.
  const { planScene, composeShotPrompt } = await import('@seanhogg/builderforce-studio');
  const storyboard = await planScene({
    apiKey: getStoredTenantToken() ?? '',
    baseUrl: getApiBaseUrl(),
    request: args.request,
    totalFrames: Math.min(MAX_SCENE_SECONDS, Math.max(4, Math.round(args.totalSeconds))),
    ...(args.signal ? { signal: args.signal } : {}),
  });
  return { storyboard, shots: shotsFromStoryboard(storyboard, composeShotPrompt) };
}
