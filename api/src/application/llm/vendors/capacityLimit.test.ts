import { describe, expect, it } from 'vitest';
import {
  isCapacityLimitBody,
  isContextOverflowBody,
  throwClassified4xx,
  VendorFatalError,
  VendorRetryableError,
} from './types';

describe('isCapacityLimitBody', () => {
  it('matches the upstream capacity/billing conditions that arrive as 400s', () => {
    const capacityBodies = [
      // Anthropic spend cap (the execution #73 payload)
      'You have reached your specified API usage limits. You will regain access on 2026-07-01 at 00:00 UTC.',
      // Anthropic credit balance
      'Your credit balance is too low to access the Anthropic API.',
      // OpenAI-shaped quota
      JSON.stringify({ error: { type: 'insufficient_quota', message: 'You exceeded your current quota' } }),
      'monthly spend limit exceeded',
      'billing hard limit reached',
    ];
    for (const body of capacityBodies) {
      expect(isCapacityLimitBody(body)).toBe(true);
    }
  });

  it('does NOT match a genuine malformed-request 400', () => {
    const payloadBugs = [
      'messages[0].role: invalid enum value "boss"',
      'tools[0].function.parameters: must be an object',
      'max_tokens must be a positive integer',
      '',
      null,
      undefined,
    ];
    for (const body of payloadBugs) {
      expect(isCapacityLimitBody(body)).toBe(false);
    }
  });
});

describe('context overflow classification', () => {
  it('normalizes an upstream 400 context error to retryable 413', () => {
    expect(isContextOverflowBody('This model maximum context length is 32768 tokens; your input has 43133 tokens')).toBe(true);
    expect(() => throwClassified4xx('openrouter', 'xiaomi/mimo-v2.5', 400, 'maximum context length is 32768 tokens')).toThrow(VendorRetryableError);
    try {
      throwClassified4xx('openrouter', 'xiaomi/mimo-v2.5', 400, 'maximum context length is 32768 tokens');
    } catch (e) {
      expect((e as VendorRetryableError).status).toBe(413);
    }
  });
});

describe('throwClassified4xx', () => {
  it('throws a retryable 429 for a capacity limit so the cascade fails over + cools the vendor', () => {
    let thrown: unknown;
    try {
      throwClassified4xx('anthropic', 'claude-opus-4-8', 400, 'You have reached your specified API usage limits.');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(VendorRetryableError);
    expect((thrown as VendorRetryableError).status).toBe(429);
    // The real upstream status is preserved in the message for trace fidelity.
    expect((thrown as VendorRetryableError).message).toContain('upstream 400');
  });

  it('throws a fatal error for a genuine malformed request (failover cannot fix it)', () => {
    let thrown: unknown;
    try {
      throwClassified4xx('openrouter', 'qwen/qwen3-coder:free', 400, 'messages[0].role: invalid enum value');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(VendorFatalError);
    expect((thrown as VendorFatalError).status).toBe(400);
  });
});
