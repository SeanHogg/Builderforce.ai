/** Moving pictures — a clip, or a story planned into shots and cut into a movie. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import {
  CANVAS_SCENE_ASPECTS,
  CANVAS_SCENE_TOOL,
  CANVAS_VIDEO_ACCOUNT_GATE,
  CANVAS_VIDEO_TOOL,
  canvasSceneMovie,
  emptyCanvasSceneSpec,
  type CanvasSceneAspect,
  type CanvasSceneShot,
  type CanvasSceneSpec,
} from '@builderforce/creation-canvas-contract';
import { getStoredTenantToken } from '@/lib/auth';
import { generateVideoClip } from '@/lib/videoGenerationApi';
import { CLOUD_SHOT_SECONDS, MAX_SCENE_SECONDS, planCloudScene, snapShotSeconds } from '@/lib/sceneStoryboard';
import { renderSceneShots } from '@/lib/sceneRendering';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import type { CreationNodeData } from '../types';
import { accountGateResult } from './accountGate';
import type { CanvasActionContext } from './context';

/** Scene lengths the planner is asked for. Long enough to tell a beat, short enough to wait for. */
const MIN_SCENE_SECONDS = 10;
const DEFAULT_SCENE_SECONDS = 30;

function aspectFrom(value: unknown): CanvasSceneAspect {
  return (CANVAS_SCENE_ASPECTS as readonly unknown[]).includes(value) ? value as CanvasSceneAspect : '16:9';
}

function titleFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback.slice(0, 80);
}

const ASPECT_PARAMETER = { type: 'string', enum: [...CANVAS_SCENE_ASPECTS], description: '16:9 landscape (default), 9:16 vertical for phones and stories, 1:1 square.' } as const;

export function canvasVideoActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, requireAccount, stage, t } = ctx;

  /** Gated on CREDENTIALS at call time, like `canvas_add_image`: clips render on the server. */
  const gate = (tool: string) => {
    if (getStoredTenantToken()) return null;
    requireAccount('video', t('gateVideoTitle'), t('gateVideoBody'));
    return accountGateResult(tool, CANVAS_VIDEO_ACCOUNT_GATE);
  };

  /** Stage the cut as an ordinary `video` object — the timeline editor music and narration are added in. */
  const stageMovie = (spec: CanvasSceneSpec, title: string, at: { x?: number; y?: number }) => {
    const movie = canvasSceneMovie(spec);
    if (!movie) return null;
    const node = stage.createObject('video', at);
    node.data = {
      ...node.data,
      kind: 'video',
      title,
      prompt: spec.prompt,
      status: t('video.movieStatus'),
      videoTimeline: movie.timeline,
      videoSources: movie.sources,
      duration: movie.timeline.clips.reduce((end, clip) => Math.max(end, clip.startSeconds + clip.durationSeconds), 0),
    } as CreationNodeData;
    stage.addObject(t('video.movieProposal', { title }), node);
    return node;
  };

  return [{
    name: CANVAS_VIDEO_TOOL,
    description: `Generate ONE real video clip from a prompt and put it on the Canvas as a video object, ready to play and edit. ALWAYS use this for "make a video / clip / animation of …" — never answer that you cannot make videos, and never stand in a storyboard or a description for the clip. For anything with several beats, a story, an ad or "a movie", use ${CANVAS_SCENE_TOOL} instead. A clip takes from half a minute to a few minutes to render.`,
    parameters: {
      type: 'object', required: ['prompt'], additionalProperties: false,
      properties: {
        prompt: { type: 'string', description: 'What the shot shows: subject, action, setting, light, camera move. Concrete and visual.' },
        durationSeconds: { type: 'number', enum: [...CLOUD_SHOT_SECONDS], description: 'Clip length. Default 5.' },
        aspectRatio: ASPECT_PARAMETER,
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = gate(CANVAS_VIDEO_TOOL);
      if (gated) return gated;
      const args = raw as { prompt?: string; durationSeconds?: number; aspectRatio?: string; title?: string; x?: number; y?: number };
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim().slice(0, 2_000) : '';
      if (!prompt) return { error: 'Pass the prompt describing the clip' };
      const aspectRatio = aspectFrom(args.aspectRatio);
      try {
        const { job, source } = await generateVideoClip({
          prompt,
          durationSeconds: snapShotSeconds(Number(args.durationSeconds) || 5),
          aspectRatio,
          useCase: 'canvas-brain-video',
        });
        const title = titleFrom(args.title, prompt);
        const node = stageMovie({ ...emptyCanvasSceneSpec(), aspectRatio, prompt, output: source }, title, args);
        if (!node) return { error: 'The clip finished without a video' };
        return {
          ok: true, proposed: true,
          object: { id: node.id, kind: 'video', title },
          durationSeconds: source.durationSeconds, model: job.result?.model, videoUrl: source.url,
          instruction: 'The clip is on the board and plays in its video object. Say so in one line; do not describe the clip in prose.',
        };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The video could not be generated') };
      }
    },
  }, {
    name: CANVAS_SCENE_TOOL,
    description: `Make a short MOVIE: plan a story into shots, render every shot as a real video clip, and cut them together. Lands two objects — a scene (the shot list; any shot can be rewritten and re-rendered) and a video (the cut, on an editable timeline where music, narration and captions are added). ALWAYS use this for "make a movie / an ad / a trailer / a short film / a scene / a story video". Use ${CANVAS_VIDEO_TOOL} for a single shot. Rendering several shots takes a few minutes.`,
    parameters: {
      type: 'object', required: ['story'], additionalProperties: false,
      properties: {
        story: { type: 'string', description: 'What the movie is: who is in it, what happens, the tone and the look. The planner turns this into shots.' },
        totalSeconds: { type: 'number', description: `Rough running time in seconds, ${MIN_SCENE_SECONDS}–${MAX_SCENE_SECONDS}. Default ${DEFAULT_SCENE_SECONDS}.` },
        aspectRatio: ASPECT_PARAMETER,
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = gate(CANVAS_SCENE_TOOL);
      if (gated) return gated;
      const args = raw as { story?: string; totalSeconds?: number; aspectRatio?: string; title?: string; x?: number; y?: number };
      const story = typeof args.story === 'string' ? args.story.trim().slice(0, 4_000) : '';
      if (!story) return { error: 'Pass the story the movie tells' };
      const aspectRatio = aspectFrom(args.aspectRatio);
      const requested = Number(args.totalSeconds);
      const totalSeconds = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Number.isFinite(requested) ? requested : DEFAULT_SCENE_SECONDS));
      try {
        const { storyboard, shots: planned } = await planCloudScene({ request: story, totalSeconds });
        // Shot progress lands on a local working copy: nothing is on the board until
        // the proposal is staged, and the stage takes the finished shot list.
        const shots: CanvasSceneShot[] = planned.map((shot) => ({ ...shot }));
        const summary = await renderSceneShots(shots, {
          aspectRatio,
          useCase: 'canvas-brain-scene',
          onShot: (shotId, patch) => {
            const index = shots.findIndex((shot) => shot.id === shotId);
            if (index >= 0) shots[index] = { ...shots[index]!, ...patch };
          },
        });
        const spec: CanvasSceneSpec = { ...emptyCanvasSceneSpec(), aspectRatio, prompt: story, storyboard, shots };
        const title = titleFrom(args.title, story);

        const scene = stage.createObject('scene', args);
        scene.data = { ...scene.data, kind: 'scene', title, status: t('video.sceneStatus', { done: summary.done, total: shots.length }), scene: spec } as CreationNodeData;
        stage.addObject(t('video.sceneProposal', { title }), scene);
        const movie = stageMovie(spec, t('scene.movieTitle', { title }), {});

        const failed = shots.filter((shot) => shot.status === 'failed');
        return {
          ok: true, proposed: true,
          scene: { id: scene.id, kind: 'scene', title },
          ...(movie ? { movie: { id: movie.id, kind: 'video', title: movie.data.title } } : {}),
          shots: shots.length, rendered: summary.done, failed: summary.failed,
          ...(failed.length ? { failures: failed.map((shot) => ({ shot: shot.action, error: shot.error })) } : {}),
          instruction: movie
            ? `The scene and its movie are on the board. Say so in one line${failed.length ? ', name the shots that failed and that they re-render from the scene object' : ''}; do not retell the story in prose.`
            : 'No shot rendered, so there is no movie yet. Relay the failures in one line; the scene object holds the shot list and re-renders it.',
        };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The scene could not be made') };
      }
    },
  }];
}
