import type { LlmUsage } from './LlmProxyService';
import { AnthropicStreamUsage, parseSseDataFrames } from '@seanhogg/builderforce-memory/wire';

/**
 * Token usage out of a full Anthropic Messages SSE stream (the concatenated `data:`
 * frames), in the gateway's {@link LlmUsage} shape. Used to meter BYO-key streaming
 * responses proxied through the gateway. The fold itself — input and cache from
 * `message_start`, cumulative output from `message_delta` — is the package's
 * {@link AnthropicStreamUsage}, the same one its Anthropic bridge meters with.
 */
export function parseAnthropicSseUsage(raw: string): LlmUsage {
  const usage = new AnthropicStreamUsage();
  for (const frame of parseSseDataFrames(raw)) usage.observe(frame);
  const t = usage.result();
  return {
    promptTokens: t.inputTokens,
    completionTokens: t.outputTokens,
    totalTokens: t.inputTokens + t.outputTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens,
  };
}
