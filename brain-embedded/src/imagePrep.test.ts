import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_MAX_EDGE, decideImageEncoding, maxEdgeOf, qualityLadder } from './imagePrep';

const pic = (over: Partial<{ type: string; size: number; width: number; height: number; hasAlpha: boolean }> = {}) => ({
  type: 'image/png',
  size: 200_000,
  width: 800,
  height: 600,
  hasAlpha: false,
  ...over,
});

describe('decideImageEncoding', () => {
  it('never re-encodes a GIF, however large (a canvas keeps one frame)', () => {
    expect(decideImageEncoding(pic({ type: 'image/gif' }))).toEqual({ kind: 'keep' });
    expect(decideImageEncoding(pic({ type: 'image/gif', width: 5_000, height: 4_000, size: 9_000_000 }))).toEqual({ kind: 'keep' });
  });

  it('keeps a small PNG / WebP / JPEG inside both caps as it is', () => {
    expect(decideImageEncoding(pic())).toEqual({ kind: 'keep' });
    expect(decideImageEncoding(pic({ type: 'image/webp', hasAlpha: true }))).toEqual({ kind: 'keep' });
    expect(decideImageEncoding(pic({ type: 'image/jpeg' }))).toEqual({ kind: 'keep' });
  });

  it('re-encodes a picture past the edge cap, keeping transparency as WebP', () => {
    const d = decideImageEncoding(pic({ width: 3_000, height: 2_000, hasAlpha: true }));
    expect(d).toMatchObject({ kind: 'encode', mime: 'image/webp', matte: false });
  });

  it('flattens an opaque oversize picture to JPEG on a white matte', () => {
    const d = decideImageEncoding(pic({ width: 3_000, height: 2_000 }));
    expect(d).toMatchObject({ kind: 'encode', mime: 'image/jpeg', matte: true });
  });

  it('re-encodes a picture whose bytes exceed the inline budget even within the edge', () => {
    expect(decideImageEncoding(pic({ size: 5_000_000 }))).toMatchObject({ kind: 'encode' });
  });

  it('always re-encodes a BMP (not a format to hand a model)', () => {
    expect(decideImageEncoding(pic({ type: 'image/bmp' }))).toMatchObject({ kind: 'encode', mime: 'image/jpeg' });
  });

  it('honours a host edge cap and first quality', () => {
    expect(decideImageEncoding(pic({ width: 800 }), { maxEdge: 512 })).toMatchObject({ kind: 'encode' });
    const d = decideImageEncoding(pic({ width: 4_000 }), { jpegQuality: 0.6 });
    expect(d.kind === 'encode' && d.qualities).toEqual([0.6, 0.55, 0.4]);
  });
});

describe('qualityLadder / maxEdgeOf', () => {
  it('defaults to the historical ladder', () => {
    expect(qualityLadder(undefined)).toEqual([0.85, 0.7, 0.55, 0.4]);
  });

  it('clamps the first rung and drops rungs at or above it', () => {
    expect(qualityLadder(2)).toEqual([1, 0.7, 0.55, 0.4]);
    expect(qualityLadder(0.1)).toEqual([0.3]);
    expect(qualityLadder(0.7)).toEqual([0.7, 0.55, 0.4]);
  });

  it('defaults the edge and ignores nonsense', () => {
    expect(maxEdgeOf()).toBe(DEFAULT_IMAGE_MAX_EDGE);
    expect(maxEdgeOf({ maxEdge: 10 })).toBe(DEFAULT_IMAGE_MAX_EDGE);
    expect(maxEdgeOf({ maxEdge: 2048.4 })).toBe(2048);
  });
});
