/**
 * `PUT /projects/:id/files/*` — the IDE write route, end to end through Hono.
 *
 * The content and zero-byte-scaffold contracts are unit-tested at their chokepoint
 * (`application/ide/workspaceStore.test.ts`). What THIS file pins is that the route
 * actually goes through that chokepoint and maps its refusal onto the wire: HTML in
 * `package.json` once reached R2 because the write was inline in the route, and a
 * Mobile project was found with all five scaffold paths stored at 0 bytes. A route
 * that regressed to an inline `bucket.put` would pass every store test and still
 * persist both — so the assertions here are on the HTTP status, the error body, and
 * what landed in the (fake) bucket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 77;
const PROJECT = 42;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('userId', 'user-abc');
    c.set('role', 'developer');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  // Ownership and write authority are mocked below, so nothing on this path queries.
  buildDatabase: () => ({}),
}));

vi.mock('../../application/project/projectOwnership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/project/projectOwnership')>()),
  projectInTenant: async () => true,
}));

vi.mock('../../application/ide/projectWriteAuthority', () => ({
  mayWriteProjectFiles: async () => true,
}));

const onCanvasWrite = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../application/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/backend')>()),
  onCanvasWrite: (...args: unknown[]) => onCanvasWrite(...args),
}));

const { createIdeRoutes } = await import('./ideRoutes');

/** In-memory R2 covering what the write path touches (get/put/list for history). */
function fakeR2() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      if (!store.has(key)) return null;
      const value = store.get(key)!;
      return { text: async () => value, body: value, size: value.length };
    },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })) };
    },
  };
}

let bucket: ReturnType<typeof fakeR2>;
const key = (path: string) => `ide/projects/${PROJECT}/${path}`;

async function put(path: string, body: string) {
  const res = await createIdeRoutes().request(
    `/projects/${PROJECT}/files/${path}`,
    { method: 'PUT', body, headers: { 'content-type': 'text/plain' } },
    { UPLOADS: bucket },
  );
  return { status: res.status, body: (await res.json()) as { error?: string; success?: boolean } };
}

beforeEach(() => {
  bucket = fakeR2();
  onCanvasWrite.mockClear();
});

describe('PUT /projects/:id/files/* — content contract', () => {
  it('refuses HTML written into package.json, stores nothing, and says why', async () => {
    const { status, body } = await put('package.json', '<!doctype html><html><body>oops</body></html>');
    expect(status).toBe(422);
    expect(body.error).toMatch(/package\.json must be valid JSON/);
    expect(bucket.store.has(key('package.json'))).toBe(false);
    expect(onCanvasWrite).not.toHaveBeenCalled();
  });

  it("refuses package.json's JSON cross-wired into vite.config.js", async () => {
    const { status, body } = await put('vite.config.js', '{"name":"app","version":"1.0.0"}');
    expect(status).toBe(422);
    expect(body.error).toMatch(/looks like JSON data/);
    expect(bucket.store.size).toBe(0);
  });

  it('writes a valid body and notifies the canvas', async () => {
    const good = '{\n  "name": "my-app"\n}';
    const { status, body } = await put('package.json', good);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(bucket.store.get(key('package.json'))).toBe(good);
    expect(onCanvasWrite).toHaveBeenCalledWith(expect.anything(), PROJECT, 'package.json');
  });

  it('refuses a traversal path with 400', async () => {
    const { status } = await put('src/..%2F..%2Fsecrets.txt', 'x');
    expect(status).toBe(400);
    expect(bucket.store.size).toBe(0);
  });
});

describe('PUT /projects/:id/files/* — zero-byte scaffold writes', () => {
  it.each(['package.json', 'index.html', 'vite.config.js', 'src/main.jsx', 'App.js'])(
    'refuses an empty body at the scaffold path %s',
    async (path) => {
      const { status, body } = await put(path, '');
      expect(status).toBe(422);
      expect(body.error).toMatch(/starter-scaffold file and cannot be written empty/);
      expect(bucket.store.size).toBe(0);
    },
  );

  it('does not let an empty body erase an existing scaffold file', async () => {
    const good = '{"name":"x"}';
    await put('package.json', good);
    const { status } = await put('package.json', '');
    expect(status).toBe(422);
    expect(bucket.store.get(key('package.json'))).toBe(good);
  });

  it('still allows creating a blank non-scaffold file', async () => {
    const { status } = await put('notes/todo.txt', '');
    expect(status).toBe(200);
    expect(bucket.store.get(key('notes/todo.txt'))).toBe('');
  });
});
