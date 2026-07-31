import { afterEach, describe, expect, it, vi } from 'vitest';
import { xaiOAuthModule } from './xaiOAuth';
import { CAPACITY_LIMIT_MARKER, VendorRetryableError } from './types';

afterEach(() => vi.unstubAllGlobals());

describe('xAI SuperGrok OAuth vendor', () => {
  it('uses the Responses API with grok-4.5 and normalizes output', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.x.ai/v1/responses');
      expect(init.headers).toMatchObject({ authorization: 'Bearer oauth-token' });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'grok-4.5', store: false });
      return new Response(JSON.stringify({ id: 'resp_xai', output_text: 'OK', usage: { input_tokens: 2, output_tokens: 1 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await xaiOAuthModule.call({ apiKey: 'oauth-token', model: 'grok-4.5', messages: [{ role: 'user', content: 'Reply OK.' }] });
    expect(result.content).toBe('OK');
    expect(result.usage).toMatchObject({ prompt_tokens: 2, completion_tokens: 1 });
  });

  it('tags a depleted weekly SuperGrok allowance as capacity, not entitlement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'You hit your weekly limit. Extra Usage Credits are being used.' } }),
      { status: 403 },
    )));
    let thrown: unknown;
    try {
      await xaiOAuthModule.call({
        apiKey: 'oauth-token', model: 'grok-4.5',
        messages: [{ role: 'user', content: 'Reply OK.' }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(VendorRetryableError);
    expect((thrown as VendorRetryableError).status).toBe(403);
    expect((thrown as VendorRetryableError).message).toContain(CAPACITY_LIMIT_MARKER);
  });

  /** Regression: this vendor used to drop `toolChoice` entirely, so a pinned tool
   *  silently ran as `auto` on Grok and the turn could come back as prose. */
  it('forwards a pinned tool in the Responses (flattened) tool_choice shape', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'resp_xai', output: [{ type: 'function_call', call_id: 'c1', name: 'save_note', arguments: '{"a":1}' }] }), { status: 200 });
    }));
    const result = await xaiOAuthModule.call({
      apiKey: 'oauth-token', model: 'grok-4.5', messages: [{ role: 'user', content: 'note it' }],
      tools: [{ type: 'function', function: { name: 'save_note', parameters: { type: 'object' } } }],
      toolChoice: { type: 'function', function: { name: 'save_note' } },
    });
    expect(sent.tool_choice).toEqual({ type: 'function', name: 'save_note' });
    expect(sent.tools).toEqual([{ type: 'function', name: 'save_note', parameters: { type: 'object' } }]);
    const raw = result.raw as { choices: Array<{ finish_reason: string; message: { tool_calls?: Array<{ function: { name: string } }> } }> };
    expect(raw.choices[0]?.finish_reason).toBe('tool_calls');
    expect(raw.choices[0]?.message.tool_calls?.[0]?.function.name).toBe('save_note');
  });

  it('passes a forced tool_choice string through unchanged', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'resp_xai', output_text: 'OK' }), { status: 200 });
    }));
    await xaiOAuthModule.call({ apiKey: 'oauth-token', model: 'grok-4.5', messages: [{ role: 'user', content: 'hi' }], toolChoice: 'required' });
    expect(sent.tool_choice).toBe('required');
  });

  /** The Responses surface rejects a `max_output_tokens` under 16; the floor is shared
   *  with the sibling Responses vendor so a tiny probe is not rejected on either. */
  it('floors max_output_tokens to the Responses minimum', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'resp_xai', output_text: 'OK' }), { status: 200 });
    }));
    await xaiOAuthModule.call({ apiKey: 'oauth-token', model: 'grok-4.5', messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });
    expect(sent.max_output_tokens).toBe(16);
  });

  /** System turns have no Responses role — they become `instructions`. Non-string
   *  content must serialize, not stringify to `[object Object]`. */
  it('folds system turns into instructions and serializes non-string content', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'resp_xai', output_text: 'OK' }), { status: 200 });
    }));
    await xaiOAuthModule.call({
      apiKey: 'oauth-token', model: 'grok-4.5',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'be terse' }] },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(sent.instructions).toBe('[{"type":"text","text":"be terse"}]');
    expect(sent.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]);
  });
});
