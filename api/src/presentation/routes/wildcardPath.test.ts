/**
 * `wildcardPath` — the contract that a trailing `*` route can actually read the
 * path it matched.
 *
 * The regression this pins: `c.req.param('*')` is `undefined` in Hono, so every
 * IDE workspace file route resolved to the empty path and answered "Path is
 * required" for a write and 404 for a read. The first test here is that exact
 * request; the rest pin mount-prefix independence, decoding, and the empty
 * segments a path validator has to be able to see.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { wildcardPath } from './wildcardPath';

/** Mount `pattern` under `prefix` and report what the wildcard matched. */
async function matched(prefix: string, pattern: string, url: string, method = 'GET'): Promise<string> {
  const sub = new Hono();
  sub.all(pattern, (c) => c.text(wildcardPath(c as never)));
  const app = new Hono();
  app.route(prefix, sub);
  const res = await app.request(`http://x${url}`, { method, body: method === 'GET' ? undefined : 'x' });
  expect(res.status).toBe(200);
  return res.text();
}

describe('wildcardPath', () => {
  it('reads the file path a workspace write was aimed at', async () => {
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/src/App.jsx', 'PUT'))
      .toBe('src/App.jsx');
  });

  it('handles a single-segment path and a deep one', async () => {
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/index.html'))
      .toBe('index.html');
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/a/b/c/d.ts'))
      .toBe('a/b/c/d.ts');
  });

  it('is independent of the mount prefix, even when the path repeats it', async () => {
    // `c.req.path.replace('/uploads/', '')` returned `/api/brainx.png` here.
    expect(await matched('/api/brain', '/uploads/*', '/api/brain/uploads/x.png')).toBe('x.png');
    // A key that repeats the literal segment survives intact.
    expect(await matched('/api/studio', '/weights/*', '/api/studio/weights/m/weights/model.onnx'))
      .toBe('m/weights/model.onnx');
    expect(await matched('/api/brain-files', '/*', '/api/brain-files/tenant/7/a.png')).toBe('tenant/7/a.png');
  });

  it('decodes each segment the way Hono decodes params', async () => {
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/src/My%20File.jsx'))
      .toBe('src/My File.jsx');
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/a%25b.txt'))
      .toBe('a%b.txt');
    // A malformed escape is passed through rather than throwing.
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/a%zz.txt'))
      .toBe('a%zz.txt');
  });

  it('preserves an empty segment so the path validator can reject it', async () => {
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files/src//App.jsx'))
      .toBe('src//App.jsx');
    // A leading slash in the caller's path is likewise visible, not swallowed.
    expect(await matched('/api/ide', '/projects/:projectId/files/*', '/api/ide/projects/50/files//src/App.jsx'))
      .toBe('/src/App.jsx');
  });

  it('returns empty when the wildcard matched nothing', async () => {
    expect(await matched('/hooks', '/:token/*', '/hooks/abc/')).toBe('');
  });

  it('reads the ingress route after the token', async () => {
    expect(await matched('/hooks', '/:token/*', '/hooks/tok_123/stripe/webhook')).toBe('stripe/webhook');
  });
});
