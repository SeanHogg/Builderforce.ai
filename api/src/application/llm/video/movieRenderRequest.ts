/**
 * Turn a canvas `video` timeline into a server render request the render
 * container can fetch — and refuse anything it should not fetch.
 *
 * The timeline and its sources are the canvas contract's own shapes
 * (`@builderforce/creation-canvas-contract` video.ts), read with the same
 * defensive parsers the editor uses, so the server renders exactly what the
 * editor shows. Each source becomes a URL the container downloads:
 *   - a source stored in the tenant's R2 (`storageKey`) → the public asset URL
 *     `/api/assets/<key>` (the key is the capability), and ONLY if the key is
 *     under this tenant's prefix — another tenant's key is refused outright;
 *   - otherwise an absolute https URL that passes the SSRF guard.
 * `blob:` and `data:` URLs never reach the server: the editor uploads before it
 * asks for a server render.
 */

import {
  canvasVideoSourcesFrom,
  canvasVideoTimelineFrom,
  type CanvasVideoSource,
} from '@builderforce/creation-canvas-contract';
import { isKeyOwnedByTenant } from '../../../domain/shared/r2Keys';
import { assertSafeUrl } from '../../../infrastructure/net/ssrfGuard';
import type { MovieRenderItem, MovieRenderRequest } from './mediaJob';

/** Longest movie the server renders, in seconds — a container-minute guard. */
export const MAX_SERVER_RENDER_SECONDS = 10 * 60;
/** Most items one render may place. */
export const MAX_SERVER_RENDER_ITEMS = 200;

export type MovieRenderBuild = { ok: true; request: MovieRenderRequest } | { ok: false; error: string };

function sourceUrl(source: CanvasVideoSource, tenantId: number, publicOrigin: string): string | null {
  if (source.storageKey) {
    return isKeyOwnedByTenant(source.storageKey, tenantId) ? `${publicOrigin}/api/assets/${source.storageKey}` : null;
  }
  try {
    return assertSafeUrl(source.url).toString();
  } catch {
    return null;
  }
}

export function buildMovieRenderRequest(args: {
  timeline: unknown;
  sources: unknown;
  tenantId: number;
  publicOrigin: string;
}): MovieRenderBuild {
  const timeline = canvasVideoTimelineFrom(args.timeline);
  const sources = new Map(canvasVideoSourcesFrom(args.sources).map((s) => [s.id, s]));
  if (timeline.clips.length === 0) return { ok: false, error: 'The timeline has no clips' };
  if (timeline.clips.length > MAX_SERVER_RENDER_ITEMS) return { ok: false, error: `A server render takes at most ${MAX_SERVER_RENDER_ITEMS} clips` };

  const items: MovieRenderItem[] = [];
  for (const clip of timeline.clips) {
    const source = sources.get(clip.sourceId);
    if (!source) return { ok: false, error: `Clip "${clip.label || clip.id}" has no media source` };
    const url = sourceUrl(source, args.tenantId, args.publicOrigin);
    if (!url) return { ok: false, error: `Clip "${clip.label || clip.id}" is not stored in this workspace, so the server cannot fetch it. Re-add the media, then render again.` };
    items.push({
      url,
      kind: source.kind,
      track: clip.track,
      startSeconds: clip.startSeconds,
      durationSeconds: clip.durationSeconds,
      trimStartSeconds: clip.trimStartSeconds,
      volume: clip.volume,
      ...(clip.captions ? { captions: clip.captions.slice(0, 300) } : {}),
    });
  }
  const length = items.reduce((end, item) => Math.max(end, item.startSeconds + item.durationSeconds), 0);
  if (length > MAX_SERVER_RENDER_SECONDS) return { ok: false, error: `A server render is limited to ${MAX_SERVER_RENDER_SECONDS / 60} minutes` };

  return {
    ok: true,
    request: {
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      backgroundColor: timeline.backgroundColor,
      items,
    },
  };
}
