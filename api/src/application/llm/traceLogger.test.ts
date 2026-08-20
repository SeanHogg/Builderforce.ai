/**
 * The image trace-shape adapter. `/v1/images` had no `llm_traces` row at all
 * because `ImageProxyService` returns an `ImageProxyResult`, not a `ProxyResult`;
 * this adapter is what lets it reach the ONE trace writer, so its mapping is
 * pinned here rather than re-derived at the call site.
 */
import { describe, it, expect } from 'vitest';
import { imageTraceResult } from './traceLogger';
import type { ImageProxyResult } from './ImageProxyService';

function imageResult(over: Partial<ImageProxyResult> = {}): ImageProxyResult {
  return {
    body: { created: 1, model: 'together/flux-schnell', data: [{ url: 'https://x/i.png' }] },
    resolvedModel: 'together/flux-schnell',
    resolvedVendor: 'together',
    retries: 0,
    failovers: [],
    paidOverflow: false,
    ...over,
  } as ImageProxyResult;
}

describe('imageTraceResult', () => {
  it('maps a served image onto a successful trace shape', () => {
    const t = imageTraceResult(imageResult(), { durationMs: 1234 });
    expect(t).toMatchObject({
      response: { status: 200 },
      status: 200,
      outcome: 'success',
      classification: null,
      resolvedModel: 'together/flux-schnell',
      resolvedVendor: 'together',
      durationMs: 1234,
    });
  });

  it('mirrors the 429 the route returns when the cascade produced no image', () => {
    // `data.length === 0` IS the image cascade's failure signal, and the route turns
    // it into a 429 — the trace must agree with what the caller received.
    const t = imageTraceResult(
      imageResult({
        body: { created: 1, model: 'flux/dev', data: [] },
        failovers: [{ model: 'together/a', vendor: 'together', code: 429 }],
        retries: 1,
      }),
      { durationMs: 90 },
    );
    expect(t.status).toBe(429);
    expect(t.response.status).toBe(429);
    expect(t.outcome).toBe('cascade_exhausted');
    expect(t.attempts).toEqual([{ model: 'together/a', vendor: 'together', status: 429 }]);
    expect(t.candidateChain).toEqual(['together/a']);
  });
});
