import { describe, expect, it, vi } from 'vitest';
import { BuilderforceClient } from '../index';

// ---------------------------------------------------------------------------
// ImagesApi — verify the SDK wires `client.images.generate()` to
// POST /llm/v1/images/generations with the OpenAI-compatible body shape and
// pulls SDK-level transport options (timeout / idempotency) out of the JSON
// payload (same DRY pattern as ChatCompletionsApi / EmbeddingsApi).
// ---------------------------------------------------------------------------

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('client.images.generate', () => {
  it('POSTs prompt + size to /llm/v1/images/generations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.builderforce.ai/llm/v1/images/generations');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.prompt).toBe('a duck on a pond');
      expect(body.size).toBe('1024x1024');
      return createJsonResponse({
        created: 100,
        data: [{ url: 'https://x/img.png' }],
        model: 'fluxapi/flux-kontext-pro',
        _builderforce: { resolvedVendor: 'fluxapi', resolvedModel: 'fluxapi/flux-kontext-pro' },
      });
    });

    const client = new BuilderforceClient({
      apiKey: 'clk_test_key',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.images.generate({
      prompt: 'a duck on a pond',
      size: '1024x1024',
    });

    expect(result.data).toEqual([{ url: 'https://x/img.png' }]);
    expect(result._builderforce?.resolvedVendor).toBe('fluxapi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends Idempotency-Key header when supplied and strips it from the JSON body', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBe('img-key-7');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.idempotencyKey).toBeUndefined();
      // timeoutMs / signal must NOT leak into the body either
      expect(body.timeoutMs).toBeUndefined();
      expect(body.signal).toBeUndefined();
      return createJsonResponse({ created: 1, data: [{ url: 'x' }], model: 'm' });
    });

    const client = new BuilderforceClient({
      apiKey: 'clk_test_key',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.images.generate({
      prompt: 'a duck',
      idempotencyKey: 'img-key-7',
      timeoutMs: 30_000,
    });
  });

  it('forwards useCase + metadata through to the gateway', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.useCase).toBe('blog_hero');
      expect(body.metadata).toEqual({ tenantPage: 'landing', revision: '3' });
      return createJsonResponse({ created: 1, data: [{ url: 'x' }], model: 'm' });
    });

    const client = new BuilderforceClient({
      apiKey: 'clk_test_key',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.images.generate({
      prompt: 'cover art',
      useCase: 'blog_hero',
      metadata: { tenantPage: 'landing', revision: '3' },
    });
  });

  it('surfaces 429 cascade-exhausted as BuilderforceApiError with failovers', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({
      error: {
        message: 'Image vendor cascade exhausted.',
        code: 429,
        type: 'rate_limit_error',
        details: {
          failovers: [
            { model: 'black-forest-labs/FLUX.1-schnell-Free', vendor: 'together', code: 429 },
            { model: 'fluxapi/flux-kontext-pro',              vendor: 'fluxapi',  code: 503 },
          ],
        },
      },
    }, 429));

    const client = new BuilderforceClient({
      apiKey: 'clk_test_key',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.images.generate({ prompt: 'a duck' }))
      .rejects.toMatchObject({
        status: 429,
        failovers: [
          { model: 'black-forest-labs/FLUX.1-schnell-Free', vendor: 'together', code: 429 },
          { model: 'fluxapi/flux-kontext-pro',              vendor: 'fluxapi',  code: 503 },
        ],
      });
  });
});

describe('client.images surface', () => {
  it('exposes generate() on the BuilderforceClient instance', () => {
    const client = new BuilderforceClient({ apiKey: 'clk_test_key' });
    expect(typeof client.images.generate).toBe('function');
  });
});
