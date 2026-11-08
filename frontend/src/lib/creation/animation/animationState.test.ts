import { describe, expect, it } from 'vitest';
import {
  createBlankAnimationState, duplicateFrame, insertFrameAfter, moveFrame, readAnimationState, removeFrame,
  totalDurationSec, updateFrameHold, updateFramePixels, frameLimit, MAX_FRAMES, MAX_ANIMATION_CHARS,
} from './animationState';
import { ANIMATION_PRESETS, animationPreset, seedAnimationFromPreset } from './animationPresets';
import { floodFillPixels, parseHexColor, toHexColor } from './rasterPaint';

const PNG = 'data:image/png;base64,AAAA';

const PAPER = '#ffffff';

describe('animation state helpers', () => {
  it('starts as one blank white frame', () => {
    const state = createBlankAnimationState(PAPER);
    expect(state.frames).toHaveLength(1);
    expect(state.frames[0]).toMatchObject({ pixelsDataUrl: null, hold: 1 });
    expect(state.background).toEqual({ kind: 'color', color: PAPER });
  });

  it('inserts, duplicates and removes frames without touching the others', () => {
    const base = createBlankAnimationState(PAPER);
    const first = base.frames[0]!.id;
    const withPixels = updateFramePixels(base, first, PNG);
    const inserted = insertFrameAfter(withPixels, first);
    expect(inserted.state.frames.map((f) => f.id)).toEqual([first, inserted.newFrameId]);
    expect(inserted.state.frames[0]).toBe(withPixels.frames[0]);

    const duped = duplicateFrame(inserted.state, first);
    expect(duped.state.frames).toHaveLength(3);
    expect(duped.state.frames[1]).toMatchObject({ id: duped.newFrameId, pixelsDataUrl: PNG });

    const removed = removeFrame(duped.state, duped.newFrameId);
    expect(removed.state.frames).toHaveLength(2);
    expect(removed.selectedId).toBe(first);
  });

  it('never removes the last frame', () => {
    const state = createBlankAnimationState(PAPER);
    const result = removeFrame(state, state.frames[0]!.id);
    expect(result.state).toBe(state);
  });

  it('moves a frame, clamped to the strip', () => {
    let state = createBlankAnimationState(PAPER);
    const a = state.frames[0]!.id;
    const b = (state = insertFrameAfter(state, a).state).frames[1]!.id;
    const c = (state = insertFrameAfter(state, b).state).frames[2]!.id;
    expect(moveFrame(state, a, 99).frames.map((f) => f.id)).toEqual([b, c, a]);
    expect(moveFrame(state, c, -5).frames.map((f) => f.id)).toEqual([c, a, b]);
    expect(moveFrame(state, a, 0)).toBe(state);
  });

  it('clamps holds and counts them in the duration', () => {
    let state = createBlankAnimationState(PAPER, 100, 100, { kind: 'transparent' }, 10);
    const id = state.frames[0]!.id;
    state = updateFrameHold(state, id, 500);
    expect(state.frames[0]!.hold).toBe(30);
    state = updateFrameHold(state, id, 0);
    expect(state.frames[0]!.hold).toBe(1);
    state = updateFrameHold(state, id, 5);
    state = insertFrameAfter(state, id).state;
    expect(totalDurationSec(state)).toBeCloseTo(0.6);
  });

});

describe('animation size limits', () => {
  it('refuses to add or duplicate past MAX_FRAMES, leaving the state untouched', () => {
    let state = createBlankAnimationState(PAPER);
    while (state.frames.length < MAX_FRAMES) state = insertFrameAfter(state, state.frames[0]!.id).state;
    expect(frameLimit(state)).toBe('maxFrames');
    const id = state.frames[0]!.id;
    expect(insertFrameAfter(state, id)).toEqual({ state, newFrameId: id });
    expect(duplicateFrame(state, id).state).toBe(state);
  });

  it('refuses a duplicate that would overspend the character budget', () => {
    let state = createBlankAnimationState(PAPER);
    state = updateFramePixels(state, state.frames[0]!.id, `data:image/png;base64,${'A'.repeat(MAX_ANIMATION_CHARS / 2 + 10)}`);
    expect(frameLimit(state)).toBeNull();
    expect(duplicateFrame(state, state.frames[0]!.id).state).toBe(state);
    expect(frameLimit({ ...state, frames: [...state.frames, { ...state.frames[0]!, id: 'x' }] })).toBe('budget');
  });

  it('keeps an uploaded frame as its URL and counts only inline frames against the budget', () => {
    const url = 'https://api.example.com/api/brain-files/frame.png?exp=1&sig=x';
    let state = createBlankAnimationState(PAPER);
    state = updateFramePixels(state, state.frames[0]!.id, url);
    expect(readAnimationState(JSON.parse(JSON.stringify(state)), PAPER).frames[0]!.pixelsDataUrl).toBe(url);
    expect(frameLimit(state, 0)).toBeNull();
    expect(frameLimit(state, MAX_ANIMATION_CHARS + 1)).toBe('budget');
    expect(duplicateFrame(state, state.frames[0]!.id).state.frames).toHaveLength(2);
  });

  it('reads at most MAX_FRAMES frames', () => {
    const frames = Array.from({ length: MAX_FRAMES + 30 }, (_, i) => ({ id: `f${i}`, pixelsDataUrl: null, hold: 1 }));
    expect(readAnimationState({ frames }, PAPER).frames).toHaveLength(MAX_FRAMES);
  });
});

describe('readAnimationState', () => {
  it('falls back to a blank state for anything unusable', () => {
    for (const value of [undefined, null, 'x', 4, []]) expect(readAnimationState(value, PAPER).frames).toHaveLength(1);
  });

  it('keeps good fields, clamps bad ones and drops non-image pixel data', () => {
    const state = readAnimationState({
      width: 99999, height: 'tall', fps: 0, onionSkinDepth: 9, loopCount: -3,
      background: { kind: 'color', color: 'javascript:alert(1)' },
      frames: [
        { id: 'a', pixelsDataUrl: PNG, hold: 2 },
        { id: 'b', pixelsDataUrl: 'javascript:alert(1)', hold: 'x' },
        'junk',
      ],
    }, PAPER);
    expect(state).toMatchObject({ width: 1920, height: 480, fps: 1, onionSkinDepth: 3, loopCount: 0, background: { kind: 'color', color: PAPER } });
    expect(state.frames).toEqual([
      { id: 'a', pixelsDataUrl: PNG, hold: 2 },
      { id: 'b', pixelsDataUrl: null, hold: 1 },
    ]);
  });

  it('round-trips a state it produced', () => {
    const state = seedAnimationFromPreset('spinner', PAPER);
    expect(readAnimationState(JSON.parse(JSON.stringify(state)), PAPER)).toEqual(state);
  });
});

describe('animation presets', () => {
  it('seeds the declared size, rate and frame count', () => {
    for (const preset of ANIMATION_PRESETS) {
      const state = seedAnimationFromPreset(preset.id, PAPER);
      expect(state).toMatchObject({ width: preset.width, height: preset.height, fps: preset.fps });
      expect(state.frames).toHaveLength(preset.starterFrames);
      expect(new Set(state.frames.map((f) => f.id)).size).toBe(preset.starterFrames);
    }
  });

  it('falls back to the blank default for an unknown id', () => {
    expect(animationPreset('nope')).toBeNull();
    expect(seedAnimationFromPreset('nope', PAPER).frames).toHaveLength(1);
  });
});

describe('raster paint', () => {
  it('parses and formats hex colours', () => {
    expect(parseHexColor('#f00')).toEqual([255, 0, 0, 255]);
    expect(parseHexColor('#0a0b0c')).toEqual([10, 11, 12, 255]);
    expect(parseHexColor('red')).toBeNull();
    expect(toHexColor(10, 11, 12)).toBe('#0a0b0c');
  });

  it('flood fills only the connected region', () => {
    // 4x3 transparent canvas with an opaque wall at x=2 splitting it in two.
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) data.set([0, 0, 0, 255], (y * width + 2) * 4);
    expect(floodFillPixels(data, width, height, 0, 0, [255, 0, 0, 255])).toBe(true);
    const at = (x: number, y: number): number[] => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(1, 2)).toEqual([255, 0, 0, 255]);
    expect(at(2, 1)).toEqual([0, 0, 0, 255]);
    expect(at(3, 0)).toEqual([0, 0, 0, 0]);
  });

  it('does nothing when filling with the colour already there, or off the canvas', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    expect(floodFillPixels(data, 2, 2, 0, 0, [255, 255, 255, 255])).toBe(false);
    expect(floodFillPixels(data, 2, 2, 5, 0, [0, 0, 0, 255])).toBe(false);
  });
});
