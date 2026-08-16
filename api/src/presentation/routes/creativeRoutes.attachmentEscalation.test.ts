import { describe, expect, it, vi } from 'vitest';

const CALLER_TENANT = 5;
const CALLER_USER = 'user-1';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', CALLER_USER);
    c.set('tenantId', CALLER_TENANT);
    c.set('role', 'developer');
    await next();
  },
}));

vi.mock('../../application/llm/tenantProxy', () => ({
  tenantProxyForPlan: vi.fn(async () => ({
    proxy: {
      complete: vi.fn(async () => ({
        response: { status: 200 },
        resolvedVendor: 'test-vendor',
        resolvedModel: 'test-model',
      })),
    },
  })),
}));

vi.mock('../../application/llm/LlmProxyService', () => ({
  ideProxy: vi.fn(),
  readProxyChoice: vi.fn(async () => ({ content: JSON.stringify({ basics: { name: 'Ada Lovelace' } }) })),
}));

import { createCreativeRoutes } from './creativeRoutes';

/** An in-memory stand-in for the R2 `UPLOADS` binding, scoped per test. */
function fakeBucket() {
  const store = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  return {
    store,
    put: vi.fn(async (key: string, bytes: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { bytes, contentType: opts.httpMetadata?.contentType ?? 'application/octet-stream' });
    }),
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return { arrayBuffer: async () => entry.bytes, httpMetadata: { contentType: entry.contentType } };
    }),
  };
}

function app(env: Record<string, unknown>) {
  const router = createCreativeRoutes();
  return { router, env };
}

describe('POST /attachments/upload', () => {
  it('uploads a file to R2 under the caller tenant/user and returns its key', async () => {
    const UPLOADS = fakeBucket();
    const { router, env } = app({ UPLOADS });
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'scan.pdf', { type: 'application/pdf' }));
    const res = await router.request('/attachments/upload', { method: 'POST', body: form }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { sourceFileKey: string };
    expect(body.sourceFileKey).toMatch(new RegExp(`^${CALLER_TENANT}/${CALLER_USER}/attachments/`));
    expect(UPLOADS.store.has(body.sourceFileKey)).toBe(true);
  });

  it('503s when file storage is not configured', async () => {
    const { router, env } = app({});
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1])], 'scan.pdf'));
    const res = await router.request('/attachments/upload', { method: 'POST', body: form }, env);
    expect(res.status).toBe(503);
  });

  it('400s with no file', async () => {
    const { router, env } = app({ UPLOADS: fakeBucket() });
    const res = await router.request('/attachments/upload', { method: 'POST', body: new FormData() }, env);
    expect(res.status).toBe(400);
  });
});

describe('POST /resume/import — escalating a retained canvas attachment', () => {
  it('reads bytes back from an R2 key uploaded earlier by this tenant', async () => {
    const UPLOADS = fakeBucket();
    const { router, env } = app({ UPLOADS });

    const uploadForm = new FormData();
    uploadForm.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'scan.pdf', { type: 'application/pdf' }));
    const uploaded = await router.request('/attachments/upload', { method: 'POST', body: uploadForm }, env);
    const { sourceFileKey } = await uploaded.json() as { sourceFileKey: string };

    const importForm = new FormData();
    importForm.append('sourceFileKey', sourceFileKey);
    importForm.append('fileName', 'scan.pdf');
    const res = await router.request('/resume/import', { method: 'POST', body: importForm }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { document: { basics: { name: string } }; sourceFileKey: string };
    expect(body.document.basics.name).toBe('Ada Lovelace');
    // The same key is returned — a fresh one is not minted for bytes already in R2.
    expect(body.sourceFileKey).toBe(sourceFileKey);
  });

  it('refuses an R2 key that belongs to a different tenant', async () => {
    const UPLOADS = fakeBucket();
    await UPLOADS.put('999/someone-else/attachments/scan.pdf', new Uint8Array([1]).buffer, { httpMetadata: { contentType: 'application/pdf' } });
    const { router, env } = app({ UPLOADS });

    const importForm = new FormData();
    importForm.append('sourceFileKey', '999/someone-else/attachments/scan.pdf');
    importForm.append('fileName', 'scan.pdf');
    const res = await router.request('/resume/import', { method: 'POST', body: importForm }, env);
    expect(res.status).toBe(403);
  });

  it('decodes an inline base64 attachment kept by a local/guest canvas that has since signed in', async () => {
    const { router, env } = app({ UPLOADS: fakeBucket() });
    const dataUrl = `data:application/pdf;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`;

    const importForm = new FormData();
    importForm.append('dataUrl', dataUrl);
    importForm.append('fileName', 'scan.pdf');
    const res = await router.request('/resume/import', { method: 'POST', body: importForm }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { document: { basics: { name: string } } };
    expect(body.document.basics.name).toBe('Ada Lovelace');
  });

  it('400s when neither a file, an R2 key, nor inline bytes are given', async () => {
    const { router, env } = app({ UPLOADS: fakeBucket() });
    const res = await router.request('/resume/import', { method: 'POST', body: new FormData() }, env);
    expect(res.status).toBe(400);
  });
});
