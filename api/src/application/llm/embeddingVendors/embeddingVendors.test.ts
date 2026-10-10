import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorFatalError, VendorRetryableError } from '../vendors/types';
import { MEMORY_EMBEDDING_DIMS, MEMORY_EMBEDDING_MODEL } from '../../memory/memoryEmbedding';
import { buildCloudflareEmbeddingBody, cloudflareEmbeddingModule, parseCloudflareEmbeddings } from './cloudflare';
import { openRouterEmbeddingModule } from './openrouter';
import { voyageEmbeddingModule } from './voyage';
import {
  dispatchEmbeddingVendor,
  EmbeddingCascadeExhaustedError,
  resolveEmbeddingCandidates,
} from './registry';

// ---------------------------------------------------------------------------
// Embeddings-vendor unit tests — exercise the OpenRouter→Voyage failover
// cascade so we confirm:
//   - a primary (OpenRouter) outage fails over to Voyage and returns its result
//   - candidate resolution honours vendor-prefix pins vs. full cascade
//   - a 400 bad payload bubbles as fatal (no failover)
//   - every-vendor-down throws EmbeddingCascadeExhaustedError
//   - a vendor with no key bound is skipped (not counted as an attempt)
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

/** Mock fetch that responds per-URL host so OpenRouter vs Voyage can be
 *  independently failed/succeeded in one cascade. */
function mockFetchByHost(handlers: { openrouter?: () => Response; voyage?: () => Response }) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('openrouter.ai')) {
      if (!handlers.openrouter) throw new Error('unexpected openrouter call');
      return handlers.openrouter();
    }
    if (url.includes('voyageai.com')) {
      if (!handlers.voyage) throw new Error('unexpected voyage call');
      return handlers.voyage();
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OK_EMBEDDINGS = (vendorModel: string) => ({
  object: 'list',
  data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
  model: vendorModel,
  usage: { prompt_tokens: 4, total_tokens: 4 },
});

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

// ===========================================================================
// Candidate resolution
// ===========================================================================

describe('resolveEmbeddingCandidates', () => {
  it('runs the full OpenRouter→Voyage→Cloudflare cascade for a bare/absent model', () => {
    const c = resolveEmbeddingCandidates();
    expect(c).toEqual([
      { vendor: 'openrouter', model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free' },
      { vendor: 'voyage', model: 'voyage-3-lite' },
      { vendor: 'cloudflare', model: '@cf/baai/bge-m3' },
    ]);
  });

  it('passes an unknown bare model through to the primary, defaults for the rest', () => {
    const c = resolveEmbeddingCandidates('openai/text-embedding-3-large');
    expect(c).toEqual([
      { vendor: 'openrouter', model: 'openai/text-embedding-3-large' },
      { vendor: 'voyage', model: 'voyage-3-lite' },
      { vendor: 'cloudflare', model: '@cf/baai/bge-m3' },
    ]);
  });

  it('pins a single vendor (no failover) for a vendor-prefixed model', () => {
    const c = resolveEmbeddingCandidates('voyage/voyage-code-3');
    expect(c).toEqual([{ vendor: 'voyage', model: 'voyage-code-3' }]);
  });

  it('pins Cloudflare for a cloudflare/-prefixed model, and routes a bare @cf/ id to it first', () => {
    expect(resolveEmbeddingCandidates('cloudflare/@cf/baai/bge-large-en-v1.5'))
      .toEqual([{ vendor: 'cloudflare', model: '@cf/baai/bge-large-en-v1.5' }]);
    expect(resolveEmbeddingCandidates('@cf/baai/bge-m3')[0]).toEqual({ vendor: 'cloudflare', model: '@cf/baai/bge-m3' });
  });

  it('keeps the memory pin (openrouter/openai/text-embedding-3-small) single-vendor — no cross-width failover', () => {
    expect(resolveEmbeddingCandidates('openrouter/openai/text-embedding-3-small'))
      .toEqual([{ vendor: 'openrouter', model: 'openai/text-embedding-3-small' }]);
  });
});

// ===========================================================================
// Declared dimensions — the memory store's vector(1536) column is bound to ONE model
// ===========================================================================

describe('embedding catalog dimensions', () => {
  it('declares the width of every catalog model', () => {
    for (const mod of [openRouterEmbeddingModule, voyageEmbeddingModule, cloudflareEmbeddingModule]) {
      for (const entry of mod.catalog) expect(entry.dimensions, `${mod.id}/${entry.id}`).toBeGreaterThan(0);
    }
  });

  it('the pinned memory model is the width the memory column stores', () => {
    const pinned = MEMORY_EMBEDDING_MODEL.replace(/^openrouter\//, '');
    expect(openRouterEmbeddingModule.catalog.find((e) => e.id === pinned)?.dimensions).toBe(MEMORY_EMBEDDING_DIMS);
  });

  it('no Cloudflare model matches the memory width — it must never be a memory fallback', () => {
    for (const entry of cloudflareEmbeddingModule.catalog) expect(entry.dimensions).not.toBe(MEMORY_EMBEDDING_DIMS);
  });
});

// ===========================================================================
// Cloudflare Workers AI vendor
// ===========================================================================

describe('cloudflare embedding vendor', () => {
  it('needs BOTH the token and the account id to count as bound', () => {
    expect(cloudflareEmbeddingModule.apiKeyFrom({ CLOUDFLARE_AI_API_TOKEN: 't' })).toBeNull();
    expect(cloudflareEmbeddingModule.apiKeyFrom({ CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' })).toBe('t::a');
  });

  it('sends `text` as an array, even for a single string', () => {
    expect(buildCloudflareEmbeddingBody({ apiKey: 'k', model: '@cf/baai/bge-m3', input: 'hi' })).toEqual({ text: ['hi'] });
  });

  it('normalises `{ result: { data } }` into the OpenAI-shaped envelope', () => {
    const out = parseCloudflareEmbeddings('@cf/baai/bge-m3', { success: true, result: { shape: [2, 2], data: [[1, 2], [3, 4]] } });
    expect(out.data).toEqual([
      { object: 'embedding', embedding: [1, 2], index: 0 },
      { object: 'embedding', embedding: [3, 4], index: 1 },
    ]);
    expect(out.model).toBe('@cf/baai/bge-m3');
  });

  it('treats a 200 with no vectors as retryable so the cascade advances', () => {
    expect(() => parseCloudflareEmbeddings('m', { success: true, result: { data: [] } })).toThrow(VendorRetryableError);
  });

  it('calls the native /ai/run endpoint with the token only, as the last failover', async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'] });
      if (url.includes('openrouter.ai')) return jsonResponse(401, { error: { message: 'User not found.' } });
      return jsonResponse(200, { success: true, result: { shape: [1, 3], data: [[0.1, 0.2, 0.3]] } });
    }) as unknown as typeof fetch;

    const result = await dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: 'or-key', CLOUDFLARE_AI_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct' },
      input: 'x',
    });
    expect(result.vendorUsed).toBe('cloudflare');
    expect(calls[1]).toEqual({
      url: 'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/baai/bge-m3',
      auth: 'Bearer cf-token',
    });
  });
});

// ===========================================================================
// Failover dispatch
// ===========================================================================

describe('dispatchEmbeddingVendor: failover', () => {
  it('fails over to Voyage when OpenRouter has an outage (503)', async () => {
    const fetchMock = mockFetchByHost({
      openrouter: () => jsonResponse(503, { error: { message: 'upstream unavailable' } }),
      voyage:     () => jsonResponse(200, OK_EMBEDDINGS('voyage-3-lite')),
    });

    const result = await dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: 'or-key', VOYAGE_API_KEY: 'vy-key' },
      input: 'hello world',
    });

    expect(result.vendorUsed).toBe('voyage');
    expect(result.data.map((d) => d.embedding)).toEqual([[0.1, 0.2, 0.3]]);
    // One recorded failed attempt (OpenRouter) before the success.
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ vendor: 'openrouter', status: 503 });
    // Both vendors were actually hit.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails over on a 200-with-empty-data from OpenRouter', async () => {
    mockFetchByHost({
      openrouter: () => jsonResponse(200, { object: 'list', data: [], model: 'x' }),
      voyage:     () => jsonResponse(200, OK_EMBEDDINGS('voyage-3-lite')),
    });

    const result = await dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: 'or-key', VOYAGE_API_KEY: 'vy-key' },
      input: ['a', 'b'],
    });

    expect(result.vendorUsed).toBe('voyage');
    expect(result.attempts[0]).toMatchObject({ vendor: 'openrouter', status: 502 });
  });

  it('skips a vendor with no key bound (not counted as an attempt)', async () => {
    const fetchMock = mockFetchByHost({
      voyage: () => jsonResponse(200, OK_EMBEDDINGS('voyage-3-lite')),
    });

    const result = await dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: null, VOYAGE_API_KEY: 'vy-key' },
      input: 'no openrouter key',
    });

    expect(result.vendorUsed).toBe('voyage');
    expect(result.attempts).toHaveLength(0); // OpenRouter skipped, not attempted
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws EmbeddingCascadeExhaustedError when every vendor is down', async () => {
    mockFetchByHost({
      openrouter: () => jsonResponse(500, { error: { message: 'boom' } }),
      voyage:     () => jsonResponse(429, { error: { message: 'rate limited' } }),
    });

    await expect(dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: 'or-key', VOYAGE_API_KEY: 'vy-key' },
      input: 'x',
    })).rejects.toBeInstanceOf(EmbeddingCascadeExhaustedError);
  });

  it('bubbles a 400 bad-payload as fatal without failing over', async () => {
    const fetchMock = mockFetchByHost({
      openrouter: () => jsonResponse(400, JSON.stringify({ error: 'bad input' })),
      // Voyage must NOT be called — fatal errors don't cascade.
    });

    await expect(dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: 'or-key', VOYAGE_API_KEY: 'vy-key' },
      input: 'x',
    })).rejects.toBeInstanceOf(VendorFatalError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
