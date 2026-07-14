import { afterEach, describe, expect, it, vi } from 'vitest';
import { xaiOAuthModule } from './xaiOAuth';

afterEach(() => vi.unstubAllGlobals());

describe('xAI SuperGrok OAuth vendor', () => {
  it('uses the Responses API with grok-4.3 and normalizes output', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.x.ai/v1/responses');
      expect(init.headers).toMatchObject({ authorization: 'Bearer oauth-token' });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'grok-4.3', store: false });
      return new Response(JSON.stringify({ id: 'resp_xai', output_text: 'OK', usage: { input_tokens: 2, output_tokens: 1 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await xaiOAuthModule.call({ apiKey: 'oauth-token', model: 'grok-4.3', messages: [{ role: 'user', content: 'Reply OK.' }] });
    expect(result.content).toBe('OK');
    expect(result.usage).toMatchObject({ prompt_tokens: 2, completion_tokens: 1 });
  });
});
