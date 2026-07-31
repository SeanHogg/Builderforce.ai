import type { LlmUsage } from './LlmProxyService';
import { parseSseDataFrames } from './sseFrames';

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

  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const frame of parseSseDataFrames(raw)) {
    const ev = frame as {
      type?: string;
      message?: { usage?: Record<string, unknown> };
      usage?: Record<string, unknown>;
    };
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
