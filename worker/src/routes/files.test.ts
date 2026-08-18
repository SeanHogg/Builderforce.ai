/**
 * The worker's file routes end-to-end over a fake R2 bucket.
 *
 * The regression pinned here: `c.req.param('*')` is `undefined` in Hono, so
 * every read/write resolved to the EMPTY path — a PUT answered "Path is
 * required" and a GET 404'd on a file that was really there. These tests drive
 * the router exactly as it is mounted in `src/index.ts`, so a route that cannot
 * see its own path fails them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../lib/auth', () => ({
  requireAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}));

const { default: files } = await import('./files');

function appWithStorage(objects: Map<string, string>) {
  const STORAGE = {
    get: async (key: string) =>
      objects.has(key) ? { text: async () => objects.get(key) as string } : null,
    put: async (key: string, value: string) => { objects.set(key, value); },
    delete: async (key: string) => { objects.delete(key); },
    list: async () => ({ objects: [...objects.keys()].map((key) => ({ key })) }),
  };
  const app = new Hono();
  app.route('/api/projects/:projectId/files', files as never);
  return (path: string, init?: RequestInit) =>
    app.request(`http://x${path}`, init, { STORAGE, JWT_SECRET: 'test' });
}

describe('worker file routes', () => {
  let objects: Map<string, string>;
  let request: ReturnType<typeof appWithStorage>;

  beforeEach(() => {
    objects = new Map([['50/src/main.jsx', 'export default 1']]);
    request = appWithStorage(objects);
  });

  it('writes a nested path to its own key', async () => {
    const res = await request('/api/projects/50/files/src/App.jsx', { method: 'PUT', body: 'export default App' });
    expect(res.status).toBe(200);
    expect(objects.get('50/src/App.jsx')).toBe('export default App');
  });

  it('reads back a file the listing reports', async () => {
    const res = await request('/api/projects/50/files/src/main.jsx');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('export default 1');
  });

  it('deletes the file that was named', async () => {
    const res = await request('/api/projects/50/files/src/main.jsx', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(objects.has('50/src/main.jsx')).toBe(false);
  });

  it('round-trips a path whose segment needed encoding', async () => {
    await request('/api/projects/50/files/src/My%20File.jsx', { method: 'PUT', body: 'x' });
    expect(objects.get('50/src/My File.jsx')).toBe('x');
  });

  it('still rejects a path the validator refuses, on the decoded value', async () => {
    // A dot segment is resolved away by URL parsing before it can ever reach the
    // router, so the shape that DOES arrive is an encoded one — decoded here, it
    // has to fail the same validator it always did.
    const res = await request('/api/projects/50/files/src%5C..%5Csecret.env', { method: 'PUT', body: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('forward slashes') });
    expect(objects.size).toBe(1);
  });

  it('rejects an empty segment instead of silently collapsing it', async () => {
    const res = await request('/api/projects/50/files/src//App.jsx', { method: 'PUT', body: 'x' });
    expect(res.status).toBe(400);
    expect(objects.has('50/src/App.jsx')).toBe(false);
  });
});
