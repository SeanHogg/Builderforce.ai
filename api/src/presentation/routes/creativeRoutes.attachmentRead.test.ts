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

/** Captures what the route asked the pool for, which is the half of this feature that
 *  cannot be seen from the response: an OCR job routed without the `ocr` use-case signal
 *  lands on a model that cannot see, and the reply looks identical. */
const completions: Array<Record<string, unknown>> = [];

vi.mock('../../application/llm/tenantProxy', () => ({
  tenantProxyForPlan: vi.fn(async () => ({
    proxy: {
      complete: vi.fn(async (request: Record<string, unknown>) => {
        completions.push(request);
        return { response: { status: 200 }, resolvedVendor: 'test-vendor', resolvedModel: 'test-model' };
      }),
    },
  })),
}));

vi.mock('../../application/llm/LlmProxyService', async (importOriginal) => ({
  // Spread the real module for the same reason the sibling escalation test does: a
  // full-replacement mock drops exports that `createCreativeRoutes`' import chain reads
  // at module load, and the file throws before a test can run.
  ...(await importOriginal<typeof import('../../application/llm/LlmProxyService')>()),
  ideProxy: vi.fn(),
  readProxyChoice: vi.fn(async () => ({ content: '# Invoice\n\nTotal: **£240.00**', body: { model: 'test-model' } })),
}));

import { createCreativeRoutes } from './creativeRoutes';

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

function withScan(key = `${CALLER_TENANT}/${CALLER_USER}/attachments/scan.pdf`) {
  const UPLOADS = fakeBucket();
  UPLOADS.store.set(key, { bytes: new Uint8Array([37, 80, 68, 70]).buffer, contentType: 'application/pdf' });
  return { UPLOADS, key, router: createCreativeRoutes() };
}

const read = (router: ReturnType<typeof createCreativeRoutes>, env: Record<string, unknown>, body: unknown) =>
  router.request('/attachments/read', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, env);

/**
 * The escalation door that was open and unused.
 *
 * `uploadAttachmentSource` has retained the bytes of every unreadable drop since it
 * shipped, and nothing ever read through it — so a scanned contract stayed an attachment
 * card. These cover the read, and in particular the two things a response cannot show: the
 * tenant boundary on a guessable key, and the OCR routing signal.
 */
describe('POST /attachments/read', () => {
  it('reads a retained scan into markdown', async () => {
    completions.length = 0;
    const { router, UPLOADS, key } = withScan();
    const res = await read(router, { UPLOADS }, { sourceFileKey: key });
    expect(res.status).toBe(200);
    const body = await res.json() as { markdown: string; sourceFileKey: string; model: string };
    expect(body.markdown).toContain('Total: **£240.00**');
    expect(body.sourceFileKey).toBe(key);
    expect(body.model).toBe('test-model');
  });

  it('signals OCR so the pool floats a model that can see', async () => {
    completions.length = 0;
    const { router, UPLOADS, key } = withScan();
    await read(router, { UPLOADS }, { sourceFileKey: key });
    // `poolRouting` matches /ocr/i on this tag. Without it the request routes to whatever
    // the general pool offers, and the failure is invisible in the reply.
    expect(String(completions[0]?.useCase)).toMatch(/ocr/i);
    // Deterministic: a transcription that varies between runs is not a transcription.
    expect(completions[0]?.temperature).toBe(0);
  });

  it('refuses a key belonging to another workspace', async () => {
    const { router, UPLOADS } = withScan();
    const res = await read(router, { UPLOADS }, { sourceFileKey: '999/someone-else/attachments/contract.pdf' });
    expect(res.status).toBe(403);
  });

  it('404s a key that names nothing', async () => {
    const { router, UPLOADS } = withScan();
    const res = await read(router, { UPLOADS }, { sourceFileKey: `${CALLER_TENANT}/${CALLER_USER}/attachments/gone.pdf` });
    expect(res.status).toBe(404);
  });

  it('refuses a file type that has no page to read', async () => {
    const { router, UPLOADS } = withScan(`${CALLER_TENANT}/${CALLER_USER}/attachments/rows.csv`);
    const res = await read(router, { UPLOADS }, { sourceFileKey: `${CALLER_TENANT}/${CALLER_USER}/attachments/rows.csv` });
    // A CSV is parsed for free in the browser; sending it to a model would spend tokens
    // to produce a worse answer.
    expect(res.status).toBe(415);
  });

  it('requires a source rather than reading nothing', async () => {
    const { router, UPLOADS } = withScan();
    const res = await read(router, { UPLOADS }, {});
    expect(res.status).toBe(400);
  });

  it('reads an inline data URL, which is the guest escalation path', async () => {
    completions.length = 0;
    const { router, UPLOADS } = withScan();
    const res = await read(router, { UPLOADS }, {
      dataUrl: 'data:application/pdf;base64,JVBERg==',
      fileName: 'photo-of-a-page.pdf',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { sourceFileKey: string | null; fileName: string };
    expect(body.sourceFileKey).toBeNull();
    expect(body.fileName).toBe('photo-of-a-page.pdf');
  });

  it('503s rather than pretending when object storage is unconfigured', async () => {
    const { router, key } = withScan();
    const res = await read(router, {}, { sourceFileKey: key });
    expect(res.status).toBe(503);
  });
});
