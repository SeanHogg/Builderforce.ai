import { describe, expect, it } from 'vitest';
import { TENANT_BUDGET_CODES, isRateLimitFailure, isTenantBudgetFailure } from './rateLimitFailure.js';

/** ONE rule for "a model or pool was throttled" - read by the cloud classifier and the agent's outcome row. */
describe('isRateLimitFailure', () => {
  it('is true for the throttle and capacity wordings providers use', () => {
    for (const message of [
      '429 Too Many Requests',
      "Gateway 429 on model 'direct/meta/muse-spark-1.1'",
      'chat completion failed with HTTP 429: {}',
      'chat completion failed with HTTP 529: overloaded, over capacity',
      'provider rate limit hit',
      'rate-limited by upstream',
      'the pool is at capacity limit',
    ]) {
      expect(isRateLimitFailure(message), message).toBe(true);
    }
  });

  it("is true for OpenAI's own rate_limit_exceeded - a genuine provider throttle, not a tenant budget", () => {
    expect(isRateLimitFailure('chat completion failed with HTTP 429: {"error":{"code":"rate_limit_exceeded"}}')).toBe(true);
    expect(isTenantBudgetFailure('{"code":"rate_limit_exceeded"}')).toBe(false);
  });

  it("is false for each of OUR gateway's tenant-budget codes, which are also answered 429", () => {
    for (const code of TENANT_BUDGET_CODES) {
      expect(isRateLimitFailure(`chat completion failed with HTTP 429: {"code":"${code}","terminal":true}`), code).toBe(false);
    }
    expect(isRateLimitFailure('HTTP 429: Plan daily token limit reached (50,000 tokens).')).toBe(false);
  });

  it('is false for anything else, and for no message', () => {
    for (const message of ['step budget spent', 'tool calls kept failing', '', null, undefined]) {
      expect(isRateLimitFailure(message), String(message)).toBe(false);
    }
  });
});

describe('isTenantBudgetFailure', () => {
  it('reads our gateway codes and the wording the gateway uses without one', () => {
    for (const code of TENANT_BUDGET_CODES) expect(isTenantBudgetFailure(`{"code":"${code}"}`), code).toBe(true);
    for (const wording of ['Daily token limit reached', 'Monthly allowance reached', 'Member spend cap reached', 'Premium budget exhausted', 'Video generation limit reached']) {
      expect(isTenantBudgetFailure(wording), wording).toBe(true);
    }
  });

  it('is false for an ordinary failure, an unlisted *_exceeded code, and no message', () => {
    for (const message of ['HTTP 529: over capacity', '{"code":"rate_limit_exceeded"}', '{"code":"context_length_exceeded"}', '', null, undefined]) {
      expect(isTenantBudgetFailure(message), String(message)).toBe(false);
    }
  });
});
