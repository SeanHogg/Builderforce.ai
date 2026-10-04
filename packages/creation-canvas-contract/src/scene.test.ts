import { describe, expect, it } from 'vitest';
import { canvasSceneEngine, canvasSceneMovie, canvasSceneShotsToRender, canvasSceneSpecFrom, emptyCanvasSceneSpec } from './scene';

const clip = (id: string, durationSeconds: number) => ({
  id, kind: 'video' as const, captureKind: 'ai' as const, url: `https://a/${id}.mp4`, fileName: `${id}.mp4`, mimeType: 'video/mp4', durationSeconds, storageKey: `7/u/${id}.mp4`,
});

describe('scene engine', () => {
  it('new scenes render in the cloud; scenes saved before the cloud engine stay on the device', () => {
    expect(canvasSceneEngine(emptyCanvasSceneSpec())).toBe('cloud');
    expect(canvasSceneEngine(canvasSceneSpecFrom({ modelId: 'lcm-tiny-sd', prompt: 'p' }))).toBe('device');
  });
});

describe('canvasSceneSpecFrom — shots', () => {
  it('keeps valid shots, drops promptless ones, and infers status from an output', () => {
    const spec = canvasSceneSpecFrom({
      engine: 'cloud', aspectRatio: '9:16',
      shots: [
        { id: 's1', action: 'Opens the door', prompt: 'a door opens', camera: 'push-in', durationSeconds: 99, output: clip('a', 5) },
        { id: 's2', prompt: '' },
        { prompt: 'a hallway', status: 'bogus' },
      ],
    });
    expect(spec.aspectRatio).toBe('9:16');
    expect(spec.shots).toHaveLength(2);
    expect(spec.shots![0]).toMatchObject({ status: 'done', durationSeconds: 15 });
    expect(spec.shots![1]).toMatchObject({ id: 'shot-3', status: 'pending', camera: 'static' });
  });

  it('lists the shots still to render', () => {
    const spec = canvasSceneSpecFrom({ shots: [
      { id: 'a', prompt: 'x', output: clip('a', 5) },
      { id: 'b', prompt: 'y', status: 'rendering' },
      { id: 'c', prompt: 'z', status: 'failed' },
      { id: 'd', prompt: 'w' },
    ] });
    expect(canvasSceneShotsToRender(spec).map((s) => s.id)).toEqual(['c', 'd']);
  });
});

describe('canvasSceneMovie', () => {
  it('lays rendered shots end to end on the visual track at the scene aspect', () => {
    const movie = canvasSceneMovie(canvasSceneSpecFrom({
      aspectRatio: '9:16',
      shots: [
        { id: 's1', action: 'Arrival', prompt: 'p1', output: clip('a', 5) },
        { id: 's2', action: 'Not yet', prompt: 'p2' },
        { id: 's3', action: 'Departure', prompt: 'p3', output: clip('b', 4) },
      ],
    }));
    expect(movie).not.toBeNull();
    expect(movie!.timeline).toMatchObject({ width: 1080, height: 1920 });
    expect(movie!.timeline.clips.map((c) => [c.label, c.startSeconds, c.durationSeconds])).toEqual([['Arrival', 0, 5], ['Departure', 5, 4]]);
    expect(movie!.sources.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('falls back to the single generated clip, and to null with nothing rendered', () => {
    expect(canvasSceneMovie(canvasSceneSpecFrom({ prompt: 'one clip', output: clip('solo', 6) }))!.timeline.clips).toHaveLength(1);
    expect(canvasSceneMovie(emptyCanvasSceneSpec())).toBeNull();
  });
});
