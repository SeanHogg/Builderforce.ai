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
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { HonoEnv } from '../../env';

export function createStudioRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);

  router.get('/weights/*', async (c) => {
    if (!c.env.UPLOADS) {
      return c.json({ error: 'R2 weight storage not configured' }, 503);
    }

    // path looks like `/weights/lcm-dreamshaper-v7/unet/model.onnx`
    // → R2 key  `studio-weights/lcm-dreamshaper-v7/unet/model.onnx`
    const url = new URL(c.req.url);
    const subPath = url.pathname.replace(/^.*\/weights\//, '');
    if (!subPath || subPath.includes('..')) {
      return c.json({ error: 'Invalid weight path' }, 400);
    }

    const r2Key = `studio-weights/${subPath}`;
    const obj = await c.env.UPLOADS.get(r2Key);
    if (!obj) {
      return c.json({ error: 'Weight not found in R2' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('Cache-Control', 'public, immutable, max-age=31536000');
    headers.set('ETag', obj.httpEtag);
    if (obj.size) headers.set('Content-Length', String(obj.size));

    return new Response(obj.body, { headers });
  });

  return router;
}
