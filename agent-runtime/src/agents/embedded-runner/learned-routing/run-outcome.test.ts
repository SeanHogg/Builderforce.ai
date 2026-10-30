import { beforeEach, describe, expect, it, vi } from "vitest";
import { FailoverError } from "../../failover-error.js";

const reported = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./index.js", () => ({
  completeLearnedRun: vi.fn(async (input: Record<string, unknown>) => void reported.push(input)),
}));

import { trackRunOutcome } from "./run-outcome.js";

/**
 * What the legacy embedded runner tells the fleet about a run. Its two judgements are THE shared ones:
 * `rateLimited` is the learned-routing rule (a tenant's spent quota is NOT a throttled model, whatever
 * this runner's failover reason says) and `degraded` is the model catalog's "weaker than asked".
 */
beforeEach(() => void (reported.length = 0));

function tracker() {
  return trackRunOutcome({ runId: "run-1", isProbeSession: false });
}

describe("trackRunOutcome — degraded", () => {
  it("a direct-provider failover from opus to haiku is degraded", () => {
    const t = tracker();
    t.lockOnto({ provider: "anthropic", model: "claude-opus-4-5" }, { provider: "anthropic", model: "claude-opus-4-5" });
    t.lockOnto({ provider: "anthropic", model: "claude-haiku-4-5" }, { provider: "anthropic", model: "claude-opus-4-5" });
    t.report("completed");
    expect(reported[0]).toMatchObject({ model: "anthropic/claude-haiku-4-5", degraded: true });
  });

  it("a failover onto a model of the same standing, or none at all, is not", () => {
    const same = tracker();
    same.lockOnto({ provider: "anthropic", model: "claude-opus-4-5" }, { provider: "anthropic", model: "claude-opus-4-5" });
    same.report("completed");
    const unknown = tracker();
    unknown.lockOnto({ provider: "acme", model: "mystery-2" }, { provider: "acme", model: "mystery-1" });
    unknown.report("completed");
    expect(reported.map((r) => r.degraded)).toEqual([false, false]);
  });
});

describe("trackRunOutcome — rateLimited", () => {
  const failed = (message: string, reason: ConstructorParameters<typeof FailoverError>[1]["reason"] = "rate_limit") => {
    const t = tracker();
    t.lockOnto({ provider: "anthropic", model: "claude-opus-4-5" }, { provider: "anthropic", model: "claude-opus-4-5" });
    t.report("failed", new FailoverError(message, { reason }));
    return reported.at(-1);
  };

  it("a genuine provider throttle is rate limited", () => {
    expect(failed("429 Too Many Requests")).toMatchObject({ rateLimited: true });
    expect(failed('HTTP 429: {"error":{"code":"rate_limit_exceeded"}}')).toMatchObject({ rateLimited: true });
  });

  it("a tenant's spent quota is NOT, even though this runner classifies it as a rate_limit failover", () => {
    expect(failed('HTTP 429: {"code":"plan_token_limit_exceeded"}')).toMatchObject({ rateLimited: false });
    expect(failed("HTTP 429: Plan daily token limit reached (50,000 tokens).")).toMatchObject({ rateLimited: false });
  });

  it("is false for a non-failover error, and for a run that did not fail", () => {
    const t = tracker();
    t.lockOnto({ provider: "anthropic", model: "claude-opus-4-5" }, { provider: "anthropic", model: "claude-opus-4-5" });
    t.report("failed", new Error("429 Too Many Requests"));
    t.report("completed");
    expect(reported.map((r) => r.rateLimited)).toEqual([false, false]);
  });
});

describe("trackRunOutcome — reporting", () => {
  it("reports nothing before the run has locked onto a model, or for a probe session", () => {
    tracker().report("completed");
    const probe = trackRunOutcome({ runId: "p", isProbeSession: true });
    probe.lockOnto({ provider: "a", model: "b" }, { provider: "a", model: "b" });
    probe.report("completed");
    expect(reported).toEqual([]);
  });
});
