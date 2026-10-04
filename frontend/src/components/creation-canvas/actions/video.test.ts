import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_SCENE_TOOL, CANVAS_VIDEO_ACCOUNT_GATE, CANVAS_VIDEO_TOOL, GUEST_GATED_CANVAS_TOOLS, type CanvasSceneShot } from '@builderforce/creation-canvas-contract';

const mocks = vi.hoisted(() => ({
  token: vi.fn<() => string | null>(),
  generateVideoClip: vi.fn(),
  planCloudScene: vi.fn(),
  renderSceneShots: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getStoredTenantToken: mocks.token }));
vi.mock('@/lib/videoGenerationApi', () => ({ generateVideoClip: mocks.generateVideoClip }));
vi.mock('@/lib/sceneStoryboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sceneStoryboard')>()),
  planCloudScene: mocks.planCloudScene,
}));
vi.mock('@/lib/sceneRendering', () => ({ renderSceneShots: mocks.renderSceneShots }));

import type { CanvasActionContext } from './context';
import { canvasVideoActions } from './video';

const SOURCE = { id: 'v1', kind: 'video' as const, captureKind: 'ai' as const, url: 'https://x/v1.mp4', fileName: 'v1.mp4', mimeType: 'video/mp4', durationSeconds: 5, storageKey: 'k/v1' };

function harness() {
  const staged: Array<{ label: string; node: { id: string; data: Record<string, unknown> } }> = [];
  let next = 0;
  const ctx = {
    canEdit: true,
    requireAccount: vi.fn(),
    t: (key: string) => key,
    stage: {
      createObject: (kind: string) => ({ id: `n${++next}`, type: 'creation', position: { x: 0, y: 0 }, data: { kind, title: '' } }),
      addObject: (label: string, node: { id: string; data: Record<string, unknown> }) => staged.push({ label, node }),
    },
  } as unknown as CanvasActionContext;
  const actions = canvasVideoActions(ctx);
  const tool = (name: string) => actions.find((action) => action.name === name)!;
  return { ctx, staged, tool };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.token.mockReturnValue('tenant-token');
});

describe('canvas video tools', () => {
  it('are guest-gated in the contract, so a guest board is told the true reason', () => {
    expect(GUEST_GATED_CANVAS_TOOLS).toEqual(expect.arrayContaining([CANVAS_VIDEO_TOOL, CANVAS_SCENE_TOOL]));
  });

  it('opens the account gate with no tenant token and leaves the board alone', async () => {
    mocks.token.mockReturnValue(null);
    const { ctx, staged, tool } = harness();
    const result = await tool(CANVAS_VIDEO_TOOL).run({ prompt: 'a fox' });
    expect(result).toEqual({ requiresAccount: true, tool: CANVAS_VIDEO_TOOL, error: CANVAS_VIDEO_ACCOUNT_GATE });
    expect(ctx.requireAccount).toHaveBeenCalled();
    expect(mocks.generateVideoClip).not.toHaveBeenCalled();
    expect(staged).toEqual([]);
  });
});

describe(CANVAS_VIDEO_TOOL, () => {
  it('generates one clip and stages it as a playable video object', async () => {
    mocks.generateVideoClip.mockResolvedValue({ job: { id: 'v1', kind: 'clip', status: 'succeeded', result: { model: 'wan' } }, source: SOURCE });
    const { staged, tool } = harness();
    const result = await tool(CANVAS_VIDEO_TOOL).run({ prompt: 'a fox running through snow', aspectRatio: '9:16', durationSeconds: 7 });
    expect(mocks.generateVideoClip).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'a fox running through snow', aspectRatio: '9:16', durationSeconds: 6 }));
    expect(staged).toHaveLength(1);
    const video = staged[0]!.node.data;
    expect(video.kind).toBe('video');
    expect(video.videoSources).toEqual([SOURCE]);
    expect((video.videoTimeline as { width: number; height: number; clips: unknown[] }).clips).toHaveLength(1);
    expect((video.videoTimeline as { width: number; height: number }).height).toBeGreaterThan((video.videoTimeline as { width: number }).width);
    expect(result).toMatchObject({ ok: true, object: { kind: 'video' }, model: 'wan' });
  });

  it('relays the gateway refusal', async () => {
    mocks.generateVideoClip.mockRejectedValue(new Error('Daily video generation limit reached'));
    const { staged, tool } = harness();
    expect(await tool(CANVAS_VIDEO_TOOL).run({ prompt: 'p' })).toEqual({ error: 'Daily video generation limit reached' });
    expect(staged).toEqual([]);
  });
});

describe(CANVAS_SCENE_TOOL, () => {
  const planned: CanvasSceneShot[] = [
    { id: 's1', action: 'door opens', prompt: 'p1', camera: 'wide', durationSeconds: 5, status: 'pending' },
    { id: 's2', action: 'cat enters', prompt: 'p2', camera: 'close', durationSeconds: 5, status: 'pending' },
  ];

  it('plans, renders and stages the scene plus its movie', async () => {
    mocks.planCloudScene.mockResolvedValue({ storyboard: { shots: [] }, shots: planned });
    mocks.renderSceneShots.mockImplementation(async (shots: CanvasSceneShot[], opts: { onShot: (id: string, patch: Partial<CanvasSceneShot>) => void }) => {
      for (const shot of shots) opts.onShot(shot.id, { status: 'done', output: { ...SOURCE, id: `out-${shot.id}` } });
      return { done: shots.length, failed: 0 };
    });
    const { staged, tool } = harness();
    const result = await tool(CANVAS_SCENE_TOOL).run({ story: 'a cat finds a door', totalSeconds: 500 });
    expect(mocks.planCloudScene).toHaveBeenCalledWith({ request: 'a cat finds a door', totalSeconds: 60 });
    expect(staged.map((entry) => entry.node.data.kind)).toEqual(['scene', 'video']);
    const scene = staged[0]!.node.data.scene as { shots: CanvasSceneShot[]; engine: string };
    expect(scene.engine).toBe('cloud');
    expect(scene.shots.every((shot) => shot.output)).toBe(true);
    expect((staged[1]!.node.data.videoTimeline as { clips: unknown[] }).clips).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, shots: 2, rendered: 2, failed: 0 });
  });

  it('still stages the scene when no shot rendered, and names the failures', async () => {
    mocks.planCloudScene.mockResolvedValue({ storyboard: {}, shots: planned });
    mocks.renderSceneShots.mockImplementation(async (shots: CanvasSceneShot[], opts: { onShot: (id: string, patch: Partial<CanvasSceneShot>) => void }) => {
      for (const shot of shots) opts.onShot(shot.id, { status: 'failed', error: 'vendor down' });
      return { done: 0, failed: shots.length };
    });
    const { staged, tool } = harness();
    const result = await tool(CANVAS_SCENE_TOOL).run({ story: 'a cat finds a door' });
    expect(staged.map((entry) => entry.node.data.kind)).toEqual(['scene']);
    expect(result).toMatchObject({ ok: true, rendered: 0, failures: [{ shot: 'door opens', error: 'vendor down' }, { shot: 'cat enters', error: 'vendor down' }] });
    expect(result).not.toHaveProperty('movie');
  });
});
