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
    expect(byoAutoSeedModels(new Set(['xai', 'anthropic']), { agentic: true, vendorPriority: ['xai', 'anthropic'] })[0]).toBe('direct/xai/grok-4.5');
  });
  it('calls Codex Responses and normalizes the result', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ authorization: 'Bearer access', 'ChatGPT-Account-Id': 'acct' });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-5.3-codex', store: false });
      return new Response(JSON.stringify({ id: 'resp_1', output_text: 'done', usage: { input_tokens: 3, output_tokens: 2 } }), { status: 200 });
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
});
