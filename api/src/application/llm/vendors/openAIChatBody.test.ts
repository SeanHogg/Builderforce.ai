import { describe, expect, it } from 'vitest';
import { buildOpenAIChatBody, type VendorCallParams } from './types';

// ---------------------------------------------------------------------------
// The single OpenAI-compatible request-body builder shared by openrouter / nvidia /
// cerebras / googleai / cloudflare (replacing five identical hand-rolled copies).
// Verifies the shape, the per-vendor option hooks, and prompt-caching-on-by-default.
// ---------------------------------------------------------------------------

const base = (over: Partial<VendorCallParams> = {}): VendorCallParams => ({
  apiKey: 'k',
  model: '@cf/qwen/qwen3-30b-a3b-fp8', // non-caching model → caching is a no-op
  messages: [{ role: 'user', content: 'hi' }],
  ...over,
});

describe('buildOpenAIChatBody', () => {
  it('builds the standard OpenAI body and passes tools/tool_choice/extraBody through verbatim', () => {
    const tools = [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }];
    const body = buildOpenAIChatBody(base({
      tools, toolChoice: 'auto', maxTokens: 100, temperature: 0.2, topP: 0.9,
      extraBody: { response_format: { type: 'json_object' } },
    }));
    expect(body.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(body.tools).toBe(tools);              // nested OpenAI shape, NOT flattened
    expect(body.tool_choice).toBe('auto');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
    expect(body.response_format).toEqual({ type: 'json_object' }); // extraBody spread
  });

  it('omits optional fields when unset', () => {
    const body = buildOpenAIChatBody(base());
    expect('tools' in body).toBe(false);
    expect('tool_choice' in body).toBe(false);
    expect('max_tokens' in body).toBe(false);
    expect('temperature' in body).toBe(false);
  });

  it('honours maxTokensField (Cerebras uses max_completion_tokens)', () => {
    const body = buildOpenAIChatBody(base({ maxTokens: 50 }), { maxTokensField: 'max_completion_tokens' });
    expect(body.max_completion_tokens).toBe(50);
    expect('max_tokens' in body).toBe(false);
  });

  it('applies transformExtra to the passthrough', () => {
    const body = buildOpenAIChatBody(base({ extraBody: { drop: 1, keep: 2 } }), {
      transformExtra: (e) => { const { drop, ...rest } = e ?? {}; void drop; return rest; },
    });
    expect('drop' in body).toBe(false);
    expect(body.keep).toBe(2);
  });

  // The system prompt is the large stable prefix `applyPromptCaching` marks.
  const withSystem = (model: string): VendorCallParams => base({
    model,
    messages: [{ role: 'system', content: 'big stable instructions' }, { role: 'user', content: 'hi' }],
  });

  it('injects prompt-cache breakpoints by default for a caching-capable model', () => {
    const body = buildOpenAIChatBody(withSystem('anthropic/claude-sonnet-5'));
    expect(JSON.stringify(body.messages)).toContain('cache_control');
  });

  it('does NOT inject cache markers for a non-caching model (no-op)', () => {
    const body = buildOpenAIChatBody(withSystem('@cf/qwen/qwen3-30b-a3b-fp8'));
    expect(JSON.stringify(body.messages)).not.toContain('cache_control');
  });

  it('noCache opts out even for a caching-capable model', () => {
    const body = buildOpenAIChatBody(withSystem('anthropic/claude-sonnet-5'), { noCache: true });
    expect(JSON.stringify(body.messages)).not.toContain('cache_control');
  });
});
