/**
 * What a text classifier may read of the "all models failed" summary. A governance refusal names the tenant's gates by their authored
 * ids, which can read like a context overflow or a compaction failure, and the summary's `cause` is only the LAST attempt. These run
 * the REAL `runWithModelFallback` over scripted attempts, in both orders of CLI refusal and embedded failure.
 */
import { describe, expect, it } from "vitest";
import { isCompactionFailureError, isLikelyContextOverflowError, isTransientHttpError } from "./embedded-helpers.js";
import { FailoverError, GOVERNANCE_REFUSAL_CODE } from "./failover-error.js";
import { classifiableFailureText, FallbackSummaryError } from "./fallback-summary.js";
import { isGovernanceRefusal } from "./cli-runner/governance.js";
import { runWithModelFallback } from "./model-fallback.js";

const refusal = (gate: string, provider = "codex-cli") =>
  new FailoverError(`The ${provider} CLI backend cannot be held to this tenant's governance gates, so it was not used. Gates in force: ${gate} (block exec).`, {
    reason: "unknown",
    code: GOVERNANCE_REFUSAL_CODE,
    provider,
  });
const embeddedFailure = (message: string, status = 502) => new FailoverError(message, { reason: "timeout", provider: "anthropic", status });

/** Run a chain of [provider, model, outcome] steps; every step throws, so the chain ends in the summary. */
async function failChain(steps: Array<[string, string, Error]>): Promise<unknown> {
  const [first, ...rest] = steps;
  const byKey = new Map(steps.map(([provider, model, error]) => [`${provider}/${model}`, error]));
  try {
    await runWithModelFallback({
      cfg: undefined,
      provider: first[0],
      model: first[1],
      fallbacksOverride: rest.map(([provider, model]) => `${provider}/${model}`),
      run: async (provider, model) => {
        throw byKey.get(`${provider}/${model}`);
      },
    });
  } catch (err) {
    return err;
  }
  throw new Error("the chain did not fail");
}

describe("the fallback failure summary", () => {
  it("CLI primary refused, embedded fallback failed: the failure is the embedded one, and the gate id is never classified", async () => {
    const err = await failChain([
      ["codex-cli", "gpt", refusal("prompt-limit")],
      ["anthropic", "claude", embeddedFailure("upstream exploded")],
    ]);

    expect(err).toBeInstanceOf(FallbackSummaryError);
    const message = (err as Error).message;
    // The pre-fix reading: the joined text trips the overflow hint through the gate id.
    expect(message).toContain("prompt-limit");
    expect(isLikelyContextOverflowError(message)).toBe(true);
    // The fixed reading: only the attempt that really ran.
    expect(classifiableFailureText(err, message)).toBe("upstream exploded");
    expect(isLikelyContextOverflowError(classifiableFailureText(err, message))).toBe(false);
    expect(isGovernanceRefusal(err)).toBe(false);
  });

  it("embedded primary fails with a 502, then the CLI fallback is refused: not a refusal, and the 502 is read as the transient failure it was", async () => {
    const err = await failChain([
      ["anthropic", "claude", embeddedFailure("502 Bad Gateway")],
      ["codex-cli", "gpt", refusal("no-shell")],
    ]);

    // `cause` is the refusal (the last error), so the cause walk alone would call the whole run a refusal and switch classification off.
    expect(((err as Error).cause as FailoverError).code).toBe(GOVERNANCE_REFUSAL_CODE);
    expect(isGovernanceRefusal(err)).toBe(false);
    const text = classifiableFailureText(err, (err as Error).message);
    expect(text).toBe("502 Bad Gateway");
    expect(isTransientHttpError(text)).toBe(true);
  });

  it("a gate id that reads like a compaction failure never reaches the compaction classifier", async () => {
    const err = await failChain([
      ["codex-cli", "gpt", refusal("compaction-prompt-limit")],
      ["anthropic", "claude", embeddedFailure("upstream exploded")],
    ]);

    const message = (err as Error).message;
    expect(isCompactionFailureError(message)).toBe(true);
    expect(isCompactionFailureError(classifiableFailureText(err, message))).toBe(false);
    expect(classifiableFailureText(err, message)).not.toContain("compaction");
  });

  it("every attempt refused: the run IS a refusal, with nothing left for a classifier to read", async () => {
    const err = await failChain([
      ["codex-cli", "gpt", refusal("prompt-limit")],
      ["claude-cli", "opus", refusal("prompt-limit", "claude-cli")],
    ]);

    expect(err).toBeInstanceOf(FallbackSummaryError);
    expect((err as FallbackSummaryError).allRefused).toBe(true);
    expect(isGovernanceRefusal(err)).toBe(true);
    expect(classifiableFailureText(err, (err as Error).message)).toBe("");
    // The person still sees which gates refused.
    expect((err as Error).message).toContain("prompt-limit");
  });

  it("a chain with NO refusal is read exactly as before: the whole message, so two 5xx failures are not newly retried", async () => {
    const err = await failChain([
      ["anthropic", "claude", embeddedFailure("502 Bad Gateway", 502)],
      ["openai", "gpt", embeddedFailure("503 Service Unavailable", 503)],
    ]);

    const message = (err as Error).message;
    expect(classifiableFailureText(err, message)).toBe(message);
    expect(isTransientHttpError(classifiableFailureText(err, message))).toBe(false);
    expect((err as FallbackSummaryError).allRefused).toBe(false);
  });

  it("an attempt with no error text leaves no stray separator in front of the one that has some", async () => {
    const err = await failChain([
      ["anthropic", "claude", embeddedFailure("   ")],
      ["codex-cli", "gpt", refusal("no-shell")],
      ["openai", "gpt", embeddedFailure("502 Bad Gateway", 502)],
    ]);

    expect(classifiableFailureText(err, (err as Error).message)).toBe("502 Bad Gateway");
  });

  it("a wrapped summary is still judged by its own attempts, not by the refusal at the end of its cause chain", async () => {
    const err = await failChain([
      ["anthropic", "claude", embeddedFailure("upstream exploded")],
      ["codex-cli", "gpt", refusal("no-shell")],
    ]);

    const wrapped = new Error("turn failed", { cause: err });
    expect(isGovernanceRefusal(wrapped)).toBe(false);
    // The classifiable text is found down the cause chain the same way, so the wrapper's own words are not what a classifier reads.
    expect(classifiableFailureText(wrapped, wrapped.message)).toBe("upstream exploded");
  });

  it("a plain error is read as it is", () => {
    expect(classifiableFailureText(new Error("boom"), "boom")).toBe("boom");
  });
});
