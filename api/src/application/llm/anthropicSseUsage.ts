import type { LlmUsage } from './LlmProxyService';

/**
 * Parse token usage out of a full Anthropic Messages SSE stream (the concatenated
 * `data:` frames). Input/cache tokens arrive on `message_start.message.usage`;
 * output tokens accumulate on `message_delta.usage`. Used to meter BYO-key
 * streaming responses proxied through the gateway. Pure + defensive — malformed
 * frames are skipped, never thrown.
 */
export function parseAnthropicSseUsage(raw: string): LlmUsage {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreate = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let ev: {
      type?: string;
      message?: { usage?: Record<string, unknown> };
      usage?: Record<string, unknown>;
    };
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    if (ev.type === 'message_start' && ev.message?.usage) {
      input = n(ev.message.usage.input_tokens) || input;
      cacheRead = n(ev.message.usage.cache_read_input_tokens) || cacheRead;
      cacheCreate = n(ev.message.usage.cache_creation_input_tokens) || cacheCreate;
    } else if (ev.type === 'message_delta' && ev.usage) {
      output = n(ev.usage.output_tokens) || output;
    }
  }

  return {
    promptTokens: input,
    completionTokens: output,
    totalTokens: input + output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
  };
}
