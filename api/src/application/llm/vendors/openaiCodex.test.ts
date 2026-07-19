import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiCodexModule } from './openaiCodex';
import { byoAutoSeedModels } from '../LlmProxyService';

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI Codex subscription vendor', () => {
  it('participates in the priority-driven BYO seed', () => {
    expect(byoAutoSeedModels(new Set(['anthropic', 'openai-codex']), {
      agentic: true,
      vendorPriority: ['openai-codex', 'anthropic'],
    })[0]).toBe('openai-codex/gpt-5.3-codex');
  });

  it('allows an xAI subscription credential to lead the same BYO seed', () => {
    expect(byoAutoSeedModels(new Set(['xai-oauth', 'anthropic']), { agentic: true, vendorPriority: ['xai-oauth', 'anthropic'] })[0]).toBe('xai-oauth/grok-4.3');
  });
  /** The Codex backend answers SSE; `response.completed` carries the terminal object. */
  function codexStream(payload: unknown): Response {
    return new Response(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'do' })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: payload })}\n\n` +
      'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }

  it('calls Codex Responses with the CLI streaming contract and normalizes the result', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      // The private Codex endpoint rejects anything that isn't the CLI's contract.
      expect(init.headers).toMatchObject({
        authorization: 'Bearer access',
        'ChatGPT-Account-Id': 'acct',
        'OpenAI-Beta': 'responses=experimental',
        originator: 'codex_cli_rs',
        accept: 'text/event-stream',
      });
      expect((init.headers as Record<string, string>).session_id).toBeTruthy();
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'gpt-5.3-codex',
        instructions: 'You are a helpful assistant.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
      });
      return codexStream({ id: 'resp_1', output_text: 'done', usage: { input_tokens: 3, output_tokens: 2 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await openAiCodexModule.call({
      apiKey: JSON.stringify({ accessToken: 'access', accountId: 'acct' }),
      model: 'gpt-5.3-codex', messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content).toBe('done');
    expect(result.usage).toMatchObject({ prompt_tokens: 3, completion_tokens: 2 });
    expect((result.raw as { choices: Array<{ message: { content: string } }> }).choices[0]?.message.content).toBe('done');
  });

  it('floors max_output_tokens to the Responses minimum so a tiny probe is not rejected', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return codexStream({ id: 'resp_2', output_text: 'OK' });
    }));
    await openAiCodexModule.call({
      apiKey: JSON.stringify({ accessToken: 'access', accountId: 'acct' }),
      model: 'gpt-5.3-codex', messages: [{ role: 'user', content: 'hi' }], maxTokens: 8,
    });
    expect(sent.max_output_tokens).toBe(16);
  });

  it('falls back to the accumulated deltas when the stream ends without a terminal frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'partial' })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));
    const result = await openAiCodexModule.call({
      apiKey: JSON.stringify({ accessToken: 'access', accountId: 'acct' }),
      model: 'gpt-5.3-codex', messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content).toBe('partial');
  });

  it('raises an in-band stream failure instead of returning an empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `data: ${JSON.stringify({ type: 'response.failed', response: { error: { message: 'quota exceeded' } } })}\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));
    await expect(openAiCodexModule.call({
      apiKey: JSON.stringify({ accessToken: 'access', accountId: 'acct' }),
      model: 'gpt-5.3-codex', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/quota exceeded/);
  });

  it('still reads a plain JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'resp_3', output_text: 'json path' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const result = await openAiCodexModule.call({
      apiKey: JSON.stringify({ accessToken: 'access', accountId: 'acct' }),
      model: 'gpt-5.3-codex', messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content).toBe('json path');
  });
});
