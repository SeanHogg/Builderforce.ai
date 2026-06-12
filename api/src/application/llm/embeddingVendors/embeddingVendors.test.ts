import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorFatalError } from '../vendors/types';
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
  it('runs the full OpenRouter→Voyage cascade for a bare/absent model', () => {
    const c = resolveEmbeddingCandidates();
    expect(c).toEqual([
      { vendor: 'openrouter', model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free' },
      { vendor: 'voyage', model: 'voyage-3-lite' },
    ]);
  });

  it('passes an unknown bare model through to the primary, defaults for the rest', () => {
    const c = resolveEmbeddingCandidates('openai/text-embedding-3-large');
    expect(c).toEqual([
      { vendor: 'openrouter', model: 'openai/text-embedding-3-large' },
      { vendor: 'voyage', model: 'voyage-3-lite' },
    ]);
  });

  it('pins a single vendor (no failover) for a vendor-prefixed model', () => {
    const c = resolveEmbeddingCandidates('voyage/voyage-code-3');
    expect(c).toEqual([{ vendor: 'voyage', model: 'voyage-code-3' }]);
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
