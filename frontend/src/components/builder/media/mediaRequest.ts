import type { ImageSize } from '@/lib/imageGenerationApi';
import type { VideoAspectRatio } from '@/lib/videoGenerationApi';

/**
 * What one generation asks for — the SAME request whether a person typed it in
 * the Media panel or the agent called `generate_image_asset` /
 * `generate_video_asset`. One shape, so both paths land in one library.
 */
export type MediaShape = 'square' | 'landscape' | 'portrait';

export const MEDIA_SHAPES: readonly MediaShape[] = ['landscape', 'square', 'portrait'];

export type MediaRequest =
  | { kind: 'image'; prompt: string; shape: MediaShape }
  | { kind: 'video'; prompt: string; shape: MediaShape; durationSeconds: number };

const IMAGE_SIZE: Record<MediaShape, ImageSize> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
};

const VIDEO_ASPECT: Record<MediaShape, VideoAspectRatio> = {
  square: '1:1',
  landscape: '16:9',
  portrait: '9:16',
};

export function imageSizeFor(shape: MediaShape): ImageSize {
  return IMAGE_SIZE[shape];
}

export function videoAspectFor(shape: MediaShape): VideoAspectRatio {
  return VIDEO_ASPECT[shape];
}

/** Pixel size of an image shape, read back from its gateway size. */
export function imageDimensionsFor(shape: MediaShape): { width: number; height: number } {
  const [width, height] = IMAGE_SIZE[shape].split('x').map(Number) as [number, number];
  return { width, height };
}

export function shapeFromImageSize(size: unknown): MediaShape {
  return size === '1792x1024' ? 'landscape' : size === '1024x1792' ? 'portrait' : 'square';
}

export function shapeFromAspect(aspect: unknown): MediaShape {
  return aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape';
}

/** What a person decides about an asset the agent made. */
export type MediaReviewDecision =
  | { action: 'use' }
  | { action: 'retry'; prompt: string }
  | { action: 'discard' };
