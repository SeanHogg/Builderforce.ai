import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_API_BASE, openaiBatchAdapter, openaiBatchLine } from './openaiBatch';

const request = {
  messages: [{ role: 'user' as const, content: 'Summarise the session.' }],
  maxTokens: 800,
  temperature: 0.2,
};

afterEach(() => vi.unstubAllGlobals());

describe('openaiBatchLine', () => {
  it('reads a 200 response body with the synchronous parser', () => {
    const parsed = openaiBatchLine({
      custom_id: 'job-9',
      response: { status_code: 200, body: { model: 'gpt-4.1', choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } } },
      error: null,
    });
    expect(parsed?.outcome.ok).toBe(true);
    if (!parsed?.outcome.ok) return;
    expect(parsed.outcome.result.content).toBe('done');
    expect(parsed.outcome.result.usage?.prompt_tokens).toBe(50);
  });

  it('requeues a rate limit or server error, gives up on a 400', () => {
    expect(openaiBatchLine({ custom_id: 'a', response: { status_code: 429, body: { error: { message: 'slow' } } } })?.outcome).toMatchObject({ ok: false, retryable: true });
    expect(openaiBatchLine({ custom_id: 'b', response: { status_code: 500, body: {} } })?.outcome).toMatchObject({ ok: false, retryable: true });
    expect(openaiBatchLine({ custom_id: 'c', response: { status_code: 400, body: { error: { message: 'bad' } } } })?.outcome).toMatchObject({ ok: false, retryable: false, error: 'bad' });
    expect(openaiBatchLine({ custom_id: 'd', response: null, error: { code: 'batch_expired', message: 'expired' } })?.outcome).toMatchObject({ ok: false, retryable: true });
  });
});

describe('openaiBatchAdapter', () => {
  it('uploads a JSONL of chat-completion lines, then creates a 24h batch', async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith('/files')
        ? new Response(JSON.stringify({ id: 'file-1' }), { status: 200 })
        : new Response(JSON.stringify({ id: 'batch_1' }), { status: 200 });
    }));
    const id = await openaiBatchAdapter.submit('sk-test', [{ customId: 'job-1', model: 'gpt-4.1', request }]);
    expect(id).toBe('batch_1');
    expect(calls[0]?.[0]).toBe(`${OPENAI_API_BASE}/files`);
    const form = calls[0]?.[1].body as FormData;
    expect(form.get('purpose')).toBe('batch');
    const line = JSON.parse(await (form.get('file') as unknown as Blob).text()) as { custom_id: string; url: string; body: { model: string; max_tokens: number; stream: boolean } };
    expect(line).toMatchObject({ custom_id: 'job-1', url: '/v1/chat/completions', body: { model: 'gpt-4.1', max_tokens: 800, stream: false } });
    expect(calls[1]?.[0]).toBe(`${OPENAI_API_BASE}/batches`);
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ input_file_id: 'file-1', endpoint: '/v1/chat/completions', completion_window: '24h' });
  });

  it('maps batch statuses onto pending / ended / failed', async () => {
    const poll = async (status: string) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status }), { status: 200 })));
      return (await openaiBatchAdapter.poll('k', 'b')).state;
    };
    expect(await poll('in_progress')).toBe('pending');
    expect(await poll('finalizing')).toBe('pending');
    expect(await poll('completed')).toBe('ended');
    expect(await poll('expired')).toBe('ended');
    expect(await poll('failed')).toBe('failed');
  });

  it('reads both the output and the error file', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/batches/b')) return new Response(JSON.stringify({ status: 'completed', output_file_id: 'out', error_file_id: 'err' }), { status: 200 });
      if (url.includes('/files/out/')) return new Response(JSON.stringify({ custom_id: 'job-1', response: { status_code: 200, body: { choices: [{ message: { content: 'ok' } }] } } }), { status: 200 });
      return new Response(JSON.stringify({ custom_id: 'job-2', response: { status_code: 400, body: { error: { message: 'bad' } } } }), { status: 200 });
    }));
    const results = await openaiBatchAdapter.results('k', 'b', null);
    expect(results.get('job-1')).toMatchObject({ ok: true });
    expect(results.get('job-2')).toMatchObject({ ok: false, retryable: false });
  });
});
