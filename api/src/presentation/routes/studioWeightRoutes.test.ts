import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-1');
    c.set('tenantId', 5);
    c.set('role', 'developer');
    await next();
  },
}));

import { createStudioRoutes } from './studioWeightRoutes';

/**
 * Fake R2Bucket — object store keyed by R2 key, `.get()` returns an object
 * whose `.body` is a real ReadableStream (so the route's byte-level
 * concatenation logic runs against real stream mechanics, not a stub).
 */
function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  const put = (key: string, bytes: Uint8Array) => store.set(key, bytes);
  return {
    store,
    put,
    get: vi.fn(async (key: string) => {
      const bytes = store.get(key);
      if (!bytes) return null;
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        size: bytes.byteLength,
        httpEtag: `"${key}"`,
        httpMetadata: { contentType: 'application/octet-stream' },
      };
    }),
  };
}

async function readAll(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const get = (router: ReturnType<typeof createStudioRoutes>, env: Record<string, unknown>, path: string) =>
  router.request(path, { method: 'GET' }, env);

describe('GET /weights/*', () => {
  it('streams a plain (non-chunked) object as before', async () => {
    const UPLOADS = fakeBucket();
    UPLOADS.put('studio-weights/cogvideox-2b/manifest.json', new TextEncoder().encode('{"ok":true}'));
    const router = createStudioRoutes();

    const res = await get(router, { UPLOADS }, '/weights/cogvideox-2b/manifest.json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(res.headers.get('Content-Length')).toBe('11');
  });

  it('404s when neither the plain key nor a .part0000 chunk exists', async () => {
    const UPLOADS = fakeBucket();
    const router = createStudioRoutes();

    const res = await get(router, { UPLOADS }, '/weights/cogvideox-2b/graph/dit/model.onnx.data');
    expect(res.status).toBe(404);
  });

  it('reassembles a chunked object (multiple .partNNNN pieces) into one byte-identical stream', async () => {
    const UPLOADS = fakeBucket();
    const key = 'studio-weights/cogvideox-2b/graph/dit/model.onnx.data';
    const parts = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7]),
      new Uint8Array([8, 9, 10, 11, 12]),
    ];
    parts.forEach((p, i) => UPLOADS.put(`${key}.part${String(i).padStart(4, '0')}`, p));
    const router = createStudioRoutes();

    const res = await get(router, { UPLOADS }, '/weights/cogvideox-2b/graph/dit/model.onnx.data');
    expect(res.status).toBe(200);
    const bytes = await readAll(res.body);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('reassembles correctly when there is exactly one part', async () => {
    const UPLOADS = fakeBucket();
    const key = 'studio-weights/cogvideox-2b/weights/vae.bin';
    UPLOADS.put(`${key}.part0000`, new Uint8Array([42, 43]));
    const router = createStudioRoutes();

    const res = await get(router, { UPLOADS }, '/weights/cogvideox-2b/weights/vae.bin');
    expect(res.status).toBe(200);
    expect(Array.from(await readAll(res.body))).toEqual([42, 43]);
  });

  it('prefers the plain object over any same-named chunked parts, if somehow both exist', async () => {
    const UPLOADS = fakeBucket();
    const key = 'studio-weights/cogvideox-2b/weights/vae.bin';
    UPLOADS.put(key, new Uint8Array([99]));
    UPLOADS.put(`${key}.part0000`, new Uint8Array([1, 2, 3]));
    const router = createStudioRoutes();

    const res = await get(router, { UPLOADS }, '/weights/cogvideox-2b/weights/vae.bin');
    expect(Array.from(await readAll(res.body))).toEqual([99]);
  });

  it('503s when R2 storage is not configured', async () => {
    const router = createStudioRoutes();
    const res = await get(router, {}, '/weights/cogvideox-2b/manifest.json');
    expect(res.status).toBe(503);
  });
});
