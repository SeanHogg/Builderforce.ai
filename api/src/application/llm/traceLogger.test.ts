/**
 * The image trace-shape adapter. `/v1/images` had no `llm_traces` row at all
 * because `ImageProxyService` returns an `ImageProxyResult`, not a `ProxyResult`;
 * this adapter is what lets it reach the ONE trace writer, so its mapping is
 * pinned here rather than re-derived at the call site.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageTraceResult, logStreamedTrace, type TraceInput } from './traceLogger';
import type { ImageProxyResult } from './ImageProxyService';

// Every llm_traces write funnels through one `.insert(...).values(row)` call.
const inserted: Array<Record<string, unknown>> = [];
vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildTransactionalDatabase: () => ({
    insert: () => ({ values: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve(); } }),
    update: () => { throw new Error('a trace must never be patched after insert'); },
  }),
}));

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

describe('logStreamedTrace — one write per streamed call', () => {
  const env = {} as never;
  const input = (): TraceInput => ({
    traceId: 'tr_1', surface: 'chat', streamed: true,
    result: { response: { status: 200 }, resolvedModel: 'm', durationMs: 5 },
    responseBody: null, errorMessage: null,
  });
  const sse = (...frames: unknown[]): ReadableStream<Uint8Array> => {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
  };

  beforeEach(() => { inserted.length = 0; });

  it('inserts nothing until the stream ends, then ONE row with tokens and body', async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    const startedAt = new Date('2026-10-17T00:00:00Z');
    const out = logStreamedTrace(env, ctx, { ...input(), startedAt }, sse(
      { model: 'vendor-m', choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ));
    expect(out).not.toBeNull();
    expect(inserted).toHaveLength(0);

    const delivered = await new Response(out).text();
    await Promise.all(pending);

    expect(delivered).toContain('Hel');
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row).toMatchObject({ traceId: 'tr_1', streamed: true, promptTokens: 3, completionTokens: 2, totalTokens: 5, createdAt: startedAt });
    expect(JSON.parse(row.responseBody as string)).toMatchObject({ streamed: true, content: 'Hello', finishReason: 'stop', model: 'vendor-m' });
  });

  it("hands the usage frame to the caller's meter as well", async () => {
    const onUsage = vi.fn();
    const out = logStreamedTrace(env, null, input(), sse({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), onUsage);
    await new Response(out).text();
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 2 }));
  });

  it('writes immediately and returns null when there is no stream to tee', async () => {
    const pending: Promise<unknown>[] = [];
    const out = logStreamedTrace(env, { waitUntil: (p) => { pending.push(p); } }, input(), null);
    await Promise.all(pending);
    expect(out).toBeNull();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty('createdAt');
  });
});
