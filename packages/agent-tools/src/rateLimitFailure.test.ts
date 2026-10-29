import { describe, expect, it } from "vitest";
import { isRateLimitFailure } from "./rateLimitFailure.js";

/** ONE rule for "a model or pool was throttled" - read by the cloud classifier and the agent's outcome row. */
describe("isRateLimitFailure", () => {
  it("is true for the throttle and capacity wordings providers use", () => {
    for (const message of [
      "429 Too Many Requests",
      "Gateway 429 on model 'direct/meta/muse-spark-1.1'",
      "chat completion failed with HTTP 429: {}",
      "chat completion failed with HTTP 529: overloaded, over capacity",
      "provider rate limit hit",
      "rate-limited by upstream",
      "the pool is at capacity limit",
    ]) {
      expect(isRateLimitFailure(message), message).toBe(true);
    }
  });

  it("is false for a tenant's own spent budget, which the gateway also answers 429 - no model is throttled", () => {
    for (const message of [
      'chat completion failed with HTTP 429: {"code":"agent_host_token_limit_exceeded"}',
      'chat completion failed with HTTP 429: {"code":"plan_token_limit_exceeded"}',
      'chat completion failed with HTTP 429: {"code":"plan_monthly_token_limit_exceeded"}',
      'chat completion failed with HTTP 429: {"code":"member_spend_cap_exceeded"}',
      'chat completion failed with HTTP 429: {"code":"premium_daily_cap_exceeded"}',
      "HTTP 429: Plan daily token limit reached (50,000 tokens).",
    ]) {
      expect(isRateLimitFailure(message), message).toBe(false);
    }
  });

  it("is false for anything else, and for no message", () => {
    for (const message of ["step budget spent", "tool calls kept failing", "", null, undefined]) {
      expect(isRateLimitFailure(message), String(message)).toBe(false);
    }
  });
});
