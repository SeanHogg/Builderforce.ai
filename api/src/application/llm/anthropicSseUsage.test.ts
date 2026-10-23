import { describe, expect, it } from 'vitest';
import { anthropicUsageToLlmUsage, parseAnthropicSseUsage } from './anthropicSseUsage';

describe('parseAnthropicSseUsage', () => {
  it('extracts input/output/cache tokens from a Messages SSE stream', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"cache_read_input_tokens":40,"cache_creation_input_tokens":10}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":35}}',
      '',
      'data: [DONE]',
    ].join('\n');

    // Cache counts are a SUBSET of the ledger's prompt: 120 uncached + 40 read + 10 written.
    expect(parseAnthropicSseUsage(sse)).toEqual({
      promptTokens: 170,
      completionTokens: 35,
      totalTokens: 205,
      cacheReadTokens: 40,
      cacheCreationTokens: 10,
    });
  });

  it('uses the last message_delta output_tokens (cumulative)', () => {
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}',
      'data: {"type":"message_delta","usage":{"output_tokens":18}}',
    ].join('\n');
    expect(parseAnthropicSseUsage(sse)).toMatchObject({ promptTokens: 10, completionTokens: 18, totalTokens: 28 });
  });

  it('returns zeros for an empty / usage-less stream', () => {
    expect(parseAnthropicSseUsage('')).toEqual({
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    });
  });

  it('skips malformed data frames without throwing', () => {
    const sse = [
      'data: not json',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}',
      ': comment line',
      'data: {"type":"message_delta","usage":{"output_tokens":3}}',
    ].join('\n');
    expect(parseAnthropicSseUsage(sse)).toMatchObject({ promptTokens: 7, completionTokens: 3 });
  });

  it('never leaves the uncached remainder negative (prompt − read − creation = input)', () => {
    const u = anthropicUsageToLlmUsage({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 900, cacheCreationTokens: 100 });
    expect(u.promptTokens - (u.cacheReadTokens ?? 0) - (u.cacheCreationTokens ?? 0)).toBe(5);
    expect(u.totalTokens).toBe(1007);
  });
});
