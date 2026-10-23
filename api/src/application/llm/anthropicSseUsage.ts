import type { LlmUsage } from './proxyTypes';
import { AnthropicStreamUsage, parseSseDataFrames } from '@seanhogg/builderforce-memory/wire';
import { anthropicPromptTokens } from './vendors/anthropic';

/** Anthropic-native token counts (input EXCLUDES both cache counts, as the API reports). */
export interface AnthropicTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Anthropic-native counts in the ledger's {@link LlmUsage} shape. The cache counts are
 * a SUBSET of `promptTokens` there (`usageLedger` prices `prompt − read − creation` as
 * uncached), so the prompt is input + both cache counts — {@link anthropicPromptTokens}.
 */
export function anthropicUsageToLlmUsage(t: AnthropicTokenCounts): LlmUsage {
  const promptTokens = anthropicPromptTokens(t);
  return {
    promptTokens,
    completionTokens: t.outputTokens,
    totalTokens: promptTokens + t.outputTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens,
  };
}

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
  return anthropicUsageToLlmUsage(usage.result());
}
