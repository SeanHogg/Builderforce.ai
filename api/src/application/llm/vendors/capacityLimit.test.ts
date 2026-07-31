import { describe, expect, it } from 'vitest';
import {
  CAPACITY_LIMIT_MARKER,
  isAccountUnusableBody,
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
      // xAI SuperGrok weekly allowance (shown in Settings ▸ Usage).
      'You hit your weekly limit. Extra Usage Credits are being used.',
      'Weekly SuperGrok Limit: 100% used',
      'Your weekly API usage allowance is depleted.',
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
      '`name` must match ^[a-zA-Z0-9_.-]+$',
      '',
      null,
      undefined,
    ];
    for (const body of payloadBugs) {
      expect(isCapacityLimitBody(body)).toBe(false);
    }
  });

  // An account that cannot be billed cannot serve ANY request, so it must stand the
  // vendor down and let the cascade continue — not kill the run as a caller bug.
  // Measured: a tenant's Meta BYO account (FIRST in its BYO precedence) failed
  // billing verification and terminated every cloud coding run routed to it.
  it('matches an ACCOUNT-unusable 400 (task 683 / execution #4259)', () => {
    const accountBodies = [
      'Billing verification failed. Please check your payment method.',
      JSON.stringify({ error: { message: 'Billing verification failed. Please check your payment method.', type: 'invalid_request_error' } }),
      'Your account has been suspended.',
      'This account is not active. Add a payment method to continue.',
      'No active subscription found for this organization.',
      'Your API access is revoked.',
    ];
    for (const body of accountBodies) {
      expect(isAccountUnusableBody(body), body).toBe(true);
      expect(isCapacityLimitBody(body), body).toBe(true);
    }
  });

  it('does NOT treat a parameter-validation 400 as an account problem', () => {
    for (const body of ['`name` must match ^[a-zA-Z0-9_.-]+$', 'invalid request', 'unknown field "payment"']) {
      expect(isAccountUnusableBody(body), body).toBe(false);
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

  it('fails over (not fatally) when the ACCOUNT is unusable, carrying the capacity marker', () => {
    let thrown: unknown;
    try {
      throwClassified4xx('meta', 'muse-spark-1.1', 400, 'Billing verification failed. Please check your payment method.');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(VendorRetryableError);
    expect((thrown as VendorRetryableError).status).toBe(429);
    // The marker is what earns the 60-min vendor stand-down in classifyFailure —
    // a dead payment method will not recover inside the 5-min transient window.
    expect((thrown as VendorRetryableError).message).toContain(CAPACITY_LIMIT_MARKER);
  });
});
