import { describe, expect, it } from 'vitest';
import type { Storyboard } from '@seanhogg/builderforce-studio';
import { shotsFromStoryboard, snapShotSeconds } from './sceneStoryboard';

function storyboard(shots: Array<{ id: string; action: string; durationFrames: number }>): Storyboard {
  return { shots: shots.map((shot) => ({ ...shot, camera: 'wide' })), characters: [] } as unknown as Storyboard;
}

const compose = (shot: { action: string }) => `prompt: ${shot.action}`;

describe('snapShotSeconds', () => {
  it('snaps to the nearest length a cloud model renders', () => {
    expect(snapShotSeconds(5)).toBe(5);
    expect(snapShotSeconds(7)).toBe(6);
    expect(snapShotSeconds(9)).toBe(8);
    expect(snapShotSeconds(30)).toBe(10);
    expect(snapShotSeconds(1)).toBe(4);
  });

  it('falls back to 5 seconds for a missing or nonsense length', () => {
    expect(snapShotSeconds(Number.NaN)).toBe(5);
    expect(snapShotSeconds(-3)).toBe(5);
  });
});

describe('shotsFromStoryboard', () => {
  it('turns planned shots into pending shots with composed prompts and snapped lengths', () => {
    const shots = shotsFromStoryboard(storyboard([{ id: 's1', action: 'door opens', durationFrames: 7 }]), compose);
    expect(shots).toEqual([{ id: 's1', action: 'door opens', prompt: 'prompt: door opens', camera: 'wide', durationSeconds: 6, status: 'pending' }]);
  });

  it('keeps a rendered clip when the shot is unchanged, and re-plans a shot whose prompt changed', () => {
    const output = { id: 'v', kind: 'video' as const, captureKind: 'ai' as const, url: 'u', fileName: 'f', mimeType: 'video/mp4', durationSeconds: 5 };
    const previous = [
      { id: 's1', action: 'door opens', prompt: 'prompt: door opens', camera: 'wide', durationSeconds: 5, status: 'done' as const, output },
      { id: 's2', action: 'old', prompt: 'prompt: old', camera: 'wide', durationSeconds: 5, status: 'done' as const, output },
    ];
    const shots = shotsFromStoryboard(storyboard([
      { id: 's1', action: 'door opens', durationFrames: 5 },
      { id: 's2', action: 'new beat', durationFrames: 5 },
    ]), compose, previous);
    expect(shots[0]).toMatchObject({ status: 'done', output });
    expect(shots[1]).toMatchObject({ status: 'pending', prompt: 'prompt: new beat' });
    expect(shots[1]).not.toHaveProperty('output');
  });
});
