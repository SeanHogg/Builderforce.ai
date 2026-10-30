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
      'The model is temporarily overloaded, please try again later',
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      'HTTP 529: Overloaded',
      'RESOURCE_EXHAUSTED: quota for this minute',
      'Provider anthropic is in cooldown (all profiles unavailable)',
      'All models failed: all in cooldown or unavailable',
    ]) {
      expect(isRateLimitFailure(message), message).toBe(true);
    }
  });

  it('reads the provider forms of resource exhaustion, not a sandbox "Resource exhausted: disk full"', () => {
    expect(isRateLimitFailure('Quota failure: the resource has been exhausted (e.g. check quota).')).toBe(true);
    expect(isRateLimitFailure('Resource exhausted: disk full')).toBe(false);
    expect(isRateLimitFailure('resource_exhausted: sandbox out of inodes')).toBe(false);
    expect(isRateLimitFailure('npm ERR! Resource exhausted while writing node_modules')).toBe(false);
  });

  it("is true for OpenAI's own rate_limit_exceeded - a genuine provider throttle, not a tenant budget", () => {
    expect(isRateLimitFailure('chat completion failed with HTTP 429: {"error":{"code":"rate_limit_exceeded"}}')).toBe(true);
    expect(isTenantBudgetFailure('{"code":"rate_limit_exceeded"}')).toBe(false);
  });

  it('reads an HTTP status the caller already holds, whatever the body says', () => {
    expect(isRateLimitFailure('upstream said no', 429)).toBe(true);
    expect(isRateLimitFailure('upstream said no', 529)).toBe(true);
    expect(isRateLimitFailure('upstream said no', 500)).toBe(false);
    expect(isRateLimitFailure('upstream said no', undefined)).toBe(false);
    expect(isRateLimitFailure('{"code":"plan_token_limit_exceeded"}', 429), 'a tenant budget wins over the status').toBe(false);
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
    for (const wording of ['Daily token limit reached', 'Monthly allowance reached', 'Member spend cap reached', 'Daily premium-model budget exhausted', 'Video generation limit reached']) {
      expect(isTenantBudgetFailure(wording), wording).toBe(true);
    }
  });

  it('is TENANT phrasing only: a bare "budget exhausted" and a run stopping at its OWN cap are not a tenant budget', () => {
    expect(isTenantBudgetFailure('401 Unauthorized: gateway retry budget exhausted')).toBe(false);
    expect(isTenantBudgetFailure('retry budget exhausted after 3 attempts')).toBe(false);
    expect(isTenantBudgetFailure('401 Unauthorized: invalid token; retry budget exhausted')).toBe(false);
    expect(isTenantBudgetFailure('token limit reached (250000/200000 tokens)')).toBe(false);
    expect(isTenantBudgetFailure('spend limit reached (900000/800000 millicents)')).toBe(false);
    expect(isTenantBudgetFailure('Plan daily token limit reached (50,000 tokens).')).toBe(true);
    expect(isTenantBudgetFailure('Per-agentHost daily token limit reached (1,000 tokens).')).toBe(true);
    expect(isTenantBudgetFailure('Daily premium-model budget exhausted (cap $5.00/day).')).toBe(true);
  });

  it('is false for an ordinary failure, an unlisted *_exceeded code, and no message', () => {
    for (const message of ['HTTP 529: over capacity', '{"code":"rate_limit_exceeded"}', '{"code":"context_length_exceeded"}', '', null, undefined]) {
      expect(isTenantBudgetFailure(message), String(message)).toBe(false);
    }
  });
});
