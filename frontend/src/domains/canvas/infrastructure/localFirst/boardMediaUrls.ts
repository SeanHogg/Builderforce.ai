/**
 * MEDIA URLS AT THE RENDER BOUNDARY — `media:<id>` in the store, an object URL on screen.
 *
 * A board's records never carry bytes or a data URL: an image is `media:<id>` and its bytes are in the
 * `BlobStore` (design §5). The canvas's renderers take a URL the page can load, so the open board
 * holds the OBJECT URL of those bytes, and this module is the only place that translates:
 *
 *   hydrate    `media:<id>` → `blob:…`    when a board is put on screen (open, reconcile, adopt)
 *   dehydrate  `blob:…`     → `media:<id>` when a board is committed (the session does it)
 *
 * The object URL of a blob is made once per page and kept (it is revoked with the page): two renders of
 * one image must not leak two URLs, and a URL the user already holds in an object must keep resolving.
 */

import type { CanvasBoard } from '../../domain/canvasBoard';
import type { BlobStore } from './blobStore';
import { MEDIA_URL_PREFIX, mediaIdsIn, mediaUrl } from './boardRecords';

const urlByMedia = new Map<string, string>();
const mediaByUrl = new Map<string, string>();

/** Remember the object URL of `blob` as media `mediaId`'s, and return it. */
export function registerMediaBlob(mediaId: string, blob: Blob): string {
  const known = urlByMedia.get(mediaId);
  if (known) return known;
  const url = URL.createObjectURL(blob);
  urlByMedia.set(mediaId, url);
  mediaByUrl.set(url, mediaId);
  return url;
}

function mapStrings<T>(value: T, map: (text: string) => string): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return map(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return walk(value) as T;
}

/** The board with every `media:<id>` replaced by its object URL; a missing blob's reference is left as it is. */
export async function hydrateBoardMedia(blobs: BlobStore, board: CanvasBoard): Promise<CanvasBoard> {
  const ids = mediaIdsIn(board);
  if (ids.length === 0) return board;
  for (const id of ids) {
    if (urlByMedia.has(id)) continue;
    const blob = await blobs.get(id);
    if (blob) registerMediaBlob(id, blob);
  }
  return mapStrings(board, (text) => {
    if (!text.startsWith(MEDIA_URL_PREFIX)) return text;
    return urlByMedia.get(text.slice(MEDIA_URL_PREFIX.length)) ?? text;
  });
}

/** The board with every object URL this page minted for media put back as `media:<id>`. */
export function dehydrateBoardMedia(board: CanvasBoard): CanvasBoard {
  if (mediaByUrl.size === 0) return board;
  return mapStrings(board, (text) => {
    if (!text.startsWith('blob:')) return text;
    const id = mediaByUrl.get(text);
    return id ? mediaUrl(id) : text;
  });
}
