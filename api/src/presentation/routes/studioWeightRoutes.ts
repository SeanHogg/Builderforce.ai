/**
 * Studio weight proxy — GET /api/studio/weights/<path>
 *
 * Streams ONNX model weights from R2 to the browser-side @seanhogg/builderforce-studio
 * engine. The studio prefers this endpoint over HuggingFace CDN because:
 *   - Predictable latency (R2 edge cache vs HF rate-limit risk)
 *   - Tenant-scoped logging for usage metrics
 *   - Lets us ship our own fine-tuned LCM variants alongside upstream models
 *
 * Auth: any authenticated tenant user. The weights are large, immutable blobs;
 * we don't bother with per-key billing here — that lives upstream in the
 * usage logging tied to the LLM gateway calls.
 *
 * Cache strategy: weights are content-addressed by model id + filename. They
 * never change for a given model version, so `Cache-Control: public,
 * immutable, max-age=31536000` lets browsers + Cloudflare's edge fully cache.
 *
 * Chunked objects: `wrangler r2 object put` refuses to upload a file over
 * 300 MiB (a CLI limit, not an R2 platform one) — a real DiT/text-encoder
 * ONNX weight file routinely exceeds that (e.g. cogvideox-2b's T5-XXL text
 * encoder graph is ~19 GB). Such files are uploaded pre-split into
 * `<key>.part0000`, `<key>.part0001`, … (250 MiB each — see
 * `webdit/converter`'s upload notes) and reassembled here transparently: a
 * miss on the exact key falls through to streaming the numbered parts back
 * to back. Callers never need to know a given weight was chunked.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';
import { wildcardPath } from './wildcardPath';

export function createStudioRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);

  router.get('/weights/*', async (c) => {
    if (!c.env.UPLOADS) {
      return c.json({ error: 'R2 weight storage not configured' }, 503);
    }

    // path looks like `/weights/lcm-dreamshaper-v7/unet/model.onnx`
    // → R2 key  `studio-weights/lcm-dreamshaper-v7/unet/model.onnx`
    const subPath = wildcardPath(c);
    if (!subPath || subPath.includes('..')) {
      return c.json({ error: 'Invalid weight path' }, 400);
    }

    const r2Key = `studio-weights/${subPath}`;
    const obj = await c.env.UPLOADS.get(r2Key);
    if (obj) {
      const headers = new Headers();
      headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
      headers.set('Cache-Control', 'public, immutable, max-age=31536000');
      headers.set('ETag', obj.httpEtag);
      if (obj.size) headers.set('Content-Length', String(obj.size));
      return new Response(obj.body, { headers });
    }

    // Not found as a single object — check whether it was uploaded chunked.
    const firstPart = await c.env.UPLOADS.get(`${r2Key}.part0000`);
    if (!firstPart) {
      return c.json({ error: 'Weight not found in R2' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Cache-Control', 'public, immutable, max-age=31536000');
    // No single ETag/Content-Length across a reassembled multi-part stream —
    // size isn't known upfront without an extra head() pass per part, and
    // callers here (getOrFetchWeight in studio) already treat a missing
    // content-length as "total unknown" rather than an error.
    return new Response(streamChunkedObject(c.env.UPLOADS, r2Key, firstPart), { headers });
  });

  return router;
}

/**
 * Concatenates `<r2Key>.part0000`, `.part0001`, … into one stream, fetching
 * each part lazily (only once the previous one is fully drained) so memory
 * stays bounded to a single ~250 MiB part at a time regardless of the
 * reassembled object's total size. `firstPart` is passed in already-fetched
 * so the caller's existence check doesn't require a second R2 round trip.
 */
function streamChunkedObject(
  bucket: R2Bucket,
  r2Key: string,
  firstPart: R2ObjectBody,
): ReadableStream<Uint8Array> {
  let partIndex = 0;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = firstPart.body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        if (!currentReader) {
          controller.close();
          return;
        }
        const { done, value } = await currentReader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        // Current part exhausted — advance to the next one, if any.
        partIndex += 1;
        const partKey = `${r2Key}.part${String(partIndex).padStart(4, '0')}`;
        const next = await bucket.get(partKey);
        currentReader = next ? next.body.getReader() : null;
      }
    },
    cancel() {
      currentReader?.cancel();
    },
  });
}
