import { describe, expect, it } from 'vitest';
import { parseAnthropicSseUsage } from './anthropicSseUsage';

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

    expect(parseAnthropicSseUsage(sse)).toEqual({
      promptTokens: 120,
      completionTokens: 35,
      totalTokens: 155,
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
});
