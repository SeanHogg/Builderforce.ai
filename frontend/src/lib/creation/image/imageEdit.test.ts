import { describe, expect, it } from 'vitest';
import type { CanvasStroke } from '@/lib/canvasDrawing';
import {
  adjustImage,
  annotationSpace,
  cropImage,
  cropWindow,
  defaultImageEdit,
  flipImage,
  imageEditFrom,
  imageExportFileName,
  imageFilter,
  imageFormatOfMime,
  imageOutputSize,
  isImageEditIdentity,
  rotateImage,
  undoImageStroke,
} from './imageEdit';

const stroke: CanvasStroke = { tool: 'line', points: [{ x: 10, y: 10 }, { x: 100, y: 10 }], stroke: 'red', strokeWidth: 3 };

describe('imageEditFrom', () => {
  it('reads nothing as the identity edit', () => {
    expect(isImageEditIdentity(imageEditFrom(undefined))).toBe(true);
    expect(isImageEditIdentity(imageEditFrom('junk'))).toBe(true);
  });

  it('clamps hostile values instead of trusting them', () => {
    const edit = imageEditFrom({ rotation: 45, adjust: { brightness: 9999, contrast: -5, saturation: 'x' }, crop: { left: 0.8, right: 0.8, top: 2 } });
    expect(edit.rotation).toBe(0);
    expect(edit.adjust).toEqual({ brightness: 200, contrast: 0, saturation: 100 });
    expect(edit.crop.left + edit.crop.right).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(edit.crop.top).toBe(0.9);
  });

  it('keeps valid strokes and drops malformed ones', () => {
    const edit = imageEditFrom({ strokes: [stroke, { tool: 'pen', points: [] }, 'nope'] });
    expect(edit.strokes).toHaveLength(1);
  });
});

describe('edit stack operations', () => {
  it('rotates in quarter turns both ways and resets the crop', () => {
    let edit = cropImage(defaultImageEdit(), { left: 0.1 });
    edit = rotateImage(edit, 1);
    expect(edit.rotation).toBe(90);
    expect(edit.crop.left).toBe(0);
    expect(rotateImage(defaultImageEdit(), -1).rotation).toBe(270);
    expect(rotateImage(rotateImage(rotateImage(rotateImage(defaultImageEdit(), 1), 1), 1), 1).rotation).toBe(0);
  });

  it('toggles flips per axis', () => {
    const edit = flipImage(flipImage(defaultImageEdit(), 'x'), 'y');
    expect(edit).toMatchObject({ flipX: true, flipY: true });
    expect(flipImage(edit, 'x').flipX).toBe(false);
  });

  it('keeps annotations when the picture is turned', () => {
    const turned = rotateImage({ ...defaultImageEdit(), strokes: [stroke] }, 1);
    expect(turned.strokes).toHaveLength(1);
  });

  it('undoes the last stroke without mutating the previous edit', () => {
    const withStroke = { ...defaultImageEdit(), strokes: [stroke, stroke] };
    expect(undoImageStroke(withStroke).strokes).toHaveLength(1);
    expect(withStroke.strokes).toHaveLength(2);
  });

  it('adjusts one channel and leaves the others', () => {
    const edit = adjustImage(defaultImageEdit(), { contrast: 130 });
    expect(edit.adjust).toEqual({ brightness: 100, contrast: 130, saturation: 100 });
    expect(isImageEditIdentity(edit)).toBe(false);
  });
});

describe('geometry', () => {
  it('swaps the output size on a quarter turn and applies the crop', () => {
    expect(imageOutputSize(400, 200, rotateImage(defaultImageEdit(), 1))).toEqual({ width: 200, height: 400 });
    expect(imageOutputSize(400, 200, cropImage(defaultImageEdit(), { left: 0.25, right: 0.25 }))).toEqual({ width: 200, height: 200 });
    expect(cropWindow(400, 200, { left: 0.25, top: 0.5, right: 0, bottom: 0 })).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });

  it('keeps the annotation space 1000 wide whatever the output', () => {
    expect(annotationSpace(2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(annotationSpace(500, 1000)).toEqual({ width: 1000, height: 2000 });
  });
});

describe('export helpers', () => {
  it('emits a neutral filter as none', () => {
    expect(imageFilter({ brightness: 100, contrast: 100, saturation: 100 })).toBe('none');
    expect(imageFilter({ brightness: 120, contrast: 90, saturation: 0 })).toBe('brightness(120%) contrast(90%) saturate(0%)');
  });

  it('names exports from the title and the format', () => {
    expect(imageExportFileName('My Hero Shot!', 'webp')).toBe('my-hero-shot-edited.webp');
    expect(imageExportFileName('   ', 'png')).toBe('image-edited.png');
  });

  it('regression: names an export from what the browser encoded (Safari answers webp with a PNG)', () => {
    expect(imageFormatOfMime('image/png')).toBe('png');
    expect(imageFormatOfMime('image/webp')).toBe('webp');
    expect(imageFormatOfMime('IMAGE/PNG; charset=binary')).toBe('png');
    expect(imageFormatOfMime('image/gif')).toBeNull();
    expect(imageExportFileName('Hero', imageFormatOfMime('image/png') ?? 'webp')).toBe('hero-edited.png');
  });
});
