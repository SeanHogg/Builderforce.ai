/**
 * Canvas pixels → a URL a social network can actually fetch.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * Instagram and TikTok do not receive media, they FETCH it — with no session and
 * no headers of ours. `social_campaigns.media_urls` therefore holds public
 * `https` URLs, while the canvas's own generated pictures live in a `data:` URI
 * or behind authenticated storage. The two halves never met: "post the image the
 * board just made" meant downloading it, uploading it somewhere public, and
 * pasting that URL back — and until someone did, the Instagram target was
 * silently `skipped` with a blocker nobody could clear from the canvas.
 *
 * ── WHY IT IS A MODULE AND NOT A BRANCH IN THE TOOL ──────────────────────────
 * Two callers publish social media from this board — `canvas_create_social_campaign`
 * (the model) and the social panel's composer (a person) — and they must resolve
 * media to the SAME URL by the SAME rules. A copy in each is a pair that drifts,
 * and the drift is invisible: the tile shows a campaign either way, and only the
 * network notices that one of them handed over a `data:` URI.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 * It does not re-host an `https` URL that is already public. Re-uploading stock
 * photography to our own bucket would spend storage and egress to produce a URL
 * no better than the one we were given.
 */

import { growthApi } from './growthApi';
import type { CreationNodeData } from '@/components/creation-canvas/types';

/** Object kinds that can carry a picture worth publishing. `video` is here so a
 *  video object reports the right reason rather than looking unsupported. */
const MEDIA_KINDS = new Set(['image', 'mockup', 'drawing', 'chart', 'comic', 'video', 'animation']);

export function isCanvasMediaKind(kind: unknown): boolean {
  return typeof kind === 'string' && MEDIA_KINDS.has(kind);
}

/**
 * Where a canvas object keeps its pixels, in the order a publisher wants them.
 *
 * `outputUrl` is the full-size render and `thumbnailUrl` is the preview, so the
 * full size is preferred and the thumbnail is the fallback — publishing a
 * thumbnail when the real render exists would post a deliberately worse picture.
 */
export function canvasMediaSource(data: Partial<CreationNodeData> | undefined): string | null {
  if (!data) return null;
  for (const key of ['outputUrl', 'renderedVideoUrl', 'videoUrl', 'imageUrl', 'thumbnailUrl'] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** True when a network could fetch this URL as-is. */
export function isPubliclyFetchable(url: string): boolean {
  return /^https:\/\//i.test(url.trim());
}

export interface PublicMediaResolution {
  /** URLs a network can fetch, in the order they were requested. */
  urls: string[];
  /** One entry per source that could not be made public, with the reason to
   *  relay. Never thrown: one unusable picture must not lose the whole campaign. */
  problems: Array<{ source: string; reason: string }>;
}

/** How much of a `data:` URI to show when naming it in an error. The whole thing
 *  is megabytes of base64 and would bury the reason it is being reported. */
const SOURCE_LABEL_LIMIT = 80;

const label = (source: string): string =>
  source.length > SOURCE_LABEL_LIMIT ? `${source.slice(0, SOURCE_LABEL_LIMIT)}…` : source;

/**
 * Resolve every source to a publicly fetchable URL, storing what needs storing.
 *
 * Sequential rather than parallel on purpose: each unresolved source is an upload
 * of up to 2 MB, and a campaign with five of them firing at once from a browser
 * is a burst nobody asked for. There are never many — a post carries one or two
 * pictures — so the wall-clock difference is a fraction of the publish itself.
 */
export async function resolvePublicMediaUrls(
  sources: readonly string[],
  opts: { name?: string } = {},
): Promise<PublicMediaResolution> {
  const urls: string[] = [];
  const problems: PublicMediaResolution['problems'] = [];

  for (const raw of sources) {
    const source = raw?.trim();
    if (!source) continue;
    if (isPubliclyFetchable(source)) { urls.push(source); continue; }
    if (source.startsWith('blob:')) {
      // A blob URL only exists inside the tab that minted it. Nothing server-side
      // can read one, so say that rather than uploading an empty file.
      problems.push({ source: label(source), reason: 'That picture is only held in this browser tab. Re-generate or re-upload it so it has a durable source.' });
      continue;
    }
    if (!source.startsWith('data:')) {
      problems.push({ source: label(source), reason: 'A social network fetches media itself, so it needs a public https URL — this one is neither https nor an inline image.' });
      continue;
    }
    try {
      const asset = await growthApi.createAssetFromSource({ source, name: opts.name?.slice(0, 120) || 'Canvas image' });
      urls.push(asset.url);
    } catch (error) {
      problems.push({ source: label(source), reason: error instanceof Error ? error.message : 'That picture could not be published to a public URL.' });
    }
  }

  return { urls, problems };
}
