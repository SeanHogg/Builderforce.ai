import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_BATCHES_ENDPOINT, anthropicBatchAdapter, anthropicBatchLine } from './anthropicBatch';

const request = {
  messages: [
    { role: 'system' as const, content: 'You classify.' },
    { role: 'user' as const, content: 'Title: add an index' },
  ],
  maxTokens: 256,
  temperature: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe('anthropicBatchLine', () => {
  it('reads a succeeded message through the synchronous translator, usage included', () => {
    const parsed = anthropicBatchLine({
      custom_id: 'job-7',
      result: {
        type: 'succeeded',
        message: { id: 'msg_1', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '{"action_type":"sql"}' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 12, cache_read_input_tokens: 40 } },
      },
    });
    expect(parsed?.customId).toBe('job-7');
    expect(parsed?.outcome.ok).toBe(true);
    if (!parsed?.outcome.ok) return;
    expect(parsed.outcome.result.content).toBe('{"action_type":"sql"}');
    // Anthropic counts cache reads outside input_tokens; the ledger counts them inside.
    expect(parsed.outcome.result.usage?.prompt_tokens).toBe(140);
    expect(parsed.outcome.result.usage?.completion_tokens).toBe(12);
  });

  it('marks an invalid request fatal and an overload retryable', () => {
    const fatal = anthropicBatchLine({ custom_id: 'job-1', result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } } });
    const transient = anthropicBatchLine({ custom_id: 'job-2', result: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } } });
    expect(fatal?.outcome).toMatchObject({ ok: false, retryable: false });
    expect(transient?.outcome).toMatchObject({ ok: false, retryable: true });
  });

  it('requeues canceled and expired requests', () => {
    expect(anthropicBatchLine({ custom_id: 'job-3', result: { type: 'expired' } })?.outcome).toMatchObject({ ok: false, retryable: true });
    expect(anthropicBatchLine({ custom_id: 'job-4', result: { type: 'canceled' } })?.outcome).toMatchObject({ ok: false, retryable: true });
  });

  it('ignores a line with no custom_id', () => {
    expect(anthropicBatchLine({ result: { type: 'succeeded' } })).toBeNull();
  });
});

describe('anthropicBatchAdapter', () => {
  it('submits each job as the synchronous Messages body under its custom_id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'msgbatch_1', processing_status: 'in_progress' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await anthropicBatchAdapter.submit('sk-ant-test', [{ customId: 'job-1', model: 'claude-haiku-5-5', request }]);
    expect(id).toBe('msgbatch_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_BATCHES_ENDPOINT);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(String(init.body)) as { requests: Array<{ custom_id: string; params: { model: string; max_tokens: number; system?: unknown; messages: unknown[] } }> };
    expect(body.requests[0]?.custom_id).toBe('job-1');
    expect(body.requests[0]?.params.model).toBe('claude-haiku-5-5');
    expect(body.requests[0]?.params.system).toBeDefined();
    expect(body.requests[0]?.params.messages).toHaveLength(1);
  });

  it('reports pending until processing ends, then the results url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ processing_status: 'in_progress' }), { status: 200 })));
    expect(await anthropicBatchAdapter.poll('k', 'b1')).toEqual({ state: 'pending' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ processing_status: 'ended', results_url: 'https://r/1' }), { status: 200 })));
    expect(await anthropicBatchAdapter.poll('k', 'b1')).toEqual({ state: 'ended', resultsRef: 'https://r/1' });
  });

  it('parses the results JSONL, skipping a malformed line', async () => {
    const jsonl = [
      JSON.stringify({ custom_id: 'job-1', result: { type: 'succeeded', message: { model: 'm', content: [{ type: 'text', text: 'hello there' }], usage: { input_tokens: 1, output_tokens: 2 } } } }),
      '{not json',
      JSON.stringify({ custom_id: 'job-2', result: { type: 'expired' } }),
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonl, { status: 200 })));
    const results = await anthropicBatchAdapter.results('k', 'b1', 'https://r/1');
    expect(results.get('job-1')).toMatchObject({ ok: true });
    expect(results.get('job-2')).toMatchObject({ ok: false, retryable: true });
    expect(results.size).toBe(2);
  });

  it('throws on a refused submit so the tick can release the jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })));
    await expect(anthropicBatchAdapter.submit('k', [{ customId: 'job-1', model: 'claude-haiku-5-5', request }])).rejects.toThrow(/HTTP 400/);
  });
});
