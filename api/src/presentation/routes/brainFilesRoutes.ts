/**
 * Public, signature-gated file serving for vision attachments.
 *
 * Mounted OUTSIDE the auth middleware (an upstream LLM provider fetching an
 * `image_url` has no tenant JWT). Access is authorized per-object by the
 * `?exp&sig` HMAC minted at `POST /api/brain/uploads/sign` — see
 * `infrastructure/auth/uploadSign.ts`. Without a valid, unexpired signature the
 * object is a 404, so this exposes nothing the bucket-wide.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { verifyUpload } from '../../infrastructure/auth/uploadSign';

export function createBrainFilesRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET /:key+?exp=..&sig=.. — serve a signed R2 object.
  router.get('/*', async (c) => {
    const env = c.env as { UPLOADS?: R2Bucket; JWT_SECRET?: string };
    if (!env.UPLOADS || !env.JWT_SECRET) return c.json({ error: 'Not found' }, 404);

    const key = c.req.path.replace('/api/brain-files/', '');
    const exp = Number(c.req.query('exp'));
    const sig = c.req.query('sig') ?? '';
    if (!key || !(await verifyUpload(key, exp, sig, env.JWT_SECRET))) {
      return c.json({ error: 'Not found' }, 404);
    }

    const obj = await env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Not found' }, 404);

    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
    // Cache only for the signature's lifetime — the URL stops working after exp.
    headers.set('Cache-Control', 'private, max-age=600');
    return new Response(obj.body, { headers });
  });

  return router;
}
