import type { AgentTool } from "../builderforce/model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isToolResultError } from "./embedded-subscribe.tools.js";
import { toToolDefinitions } from "./tool-definition-adapter.js";
import { jsonResult } from "./tools/common.js";
import {
  executeWithTransientToolRetry,
  isRetryableTool,
  isTransientToolFailure,
  retryAfterMsFromToolError,
  TRANSIENT_TOOL_RETRY_DEFAULTS,
} from "./tool-retry.js";

type ToolExecute = ReturnType<typeof toToolDefinitions>[number]["execute"];
const extensionContext = {} as Parameters<ToolExecute>[4];

/**
 * The shape a tool throws for a rate-limited call: the HTTP status the existing classifier
 * already understands (`failover-error.ts` maps 429 -> "rate_limit") plus the
 * `Retry-After` / `X-RateLimit-Reset` headers the platform rate limiter sets on every 429.
 */
function rateLimitedError(retryAfterSeconds?: number): Error {
  const headers: Record<string, string> = {};
  if (retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(retryAfterSeconds);
    headers["X-RateLimit-Reset"] = String(Date.now() + retryAfterSeconds * 1000);
  }
  return Object.assign(new Error("Rate limit exceeded. Please slow down."), {
    status: 429,
    headers,
  });
}

/** A tool that throws `makeError(attempt)` for its first `failures` calls, then succeeds. */
function flakyTool(
  name: string,
  failures: number,
  makeError: (attempt: number) => unknown,
  idempotent = true,
) {
  let attempts = 0;
  const tool = {
    name,
    label: name,
    description: "flaky",
    idempotent,
    parameters: Type.Object({}),
    execute: async () => {
      attempts += 1;
      if (attempts <= failures) {
        throw makeError(attempts);
      }
      return jsonResult({ status: "ok", attempt: attempts });
    },
  } satisfies AgentTool;
  return { tool, attempts: () => attempts };
}

async function runTool(tool: AgentTool, callId: string) {
  const defs = toToolDefinitions([tool]);
  const def = defs[0];
  if (!def) {
    throw new Error("missing tool definition");
  }
  return await def.execute(callId, {}, undefined, undefined, extensionContext);
}

describe("transient tool-failure backoff in the tool-execution path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(a) retries a 429 carrying Retry-After: 2, succeeds on a later attempt, turn survives", async () => {
    const { tool, attempts } = flakyTool("kanban_create", 2, () => rateLimitedError(2));

    const promise = runTool(tool, "call-429");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts()).toBe(3);
    expect(result.details).toMatchObject({ status: "ok", attempt: 3 });
    // A recovered 429 must never reach the model as a failed tool result (which is what
    // feeds the consecutive-failure guard that ends the turn).
    expect(isToolResultError(result)).toBe(false);
  });

  it("(a2) backs off by the server's Retry-After (2s), not by the default curve", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const promise = executeWithTransientToolRetry(
      async () => {
        attempts += 1;
        if (attempts <= 2) {
          throw rateLimitedError(2);
        }
        return "ok";
      },
      { label: "kanban_create", idempotent: true, onRetry: (info) => delays.push(info.delayMs) },
    );
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2000, 2000]);
  });

  it("(a3) a 429 with no Retry-After still backs off on the bounded curve and succeeds", async () => {
    const { tool, attempts } = flakyTool("tasks_create", 2, () => rateLimitedError());

    const promise = runTool(tool, "call-429-no-header");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts()).toBe(3);
    expect(isToolResultError(result)).toBe(false);
  });

  it("(b) does NOT retry a non-transient 400 — it fails fast with zero retries", async () => {
    const { tool, attempts } = flakyTool("tasks_create", Number.POSITIVE_INFINITY, () =>
      Object.assign(new Error("Bad request: title is required"), { status: 400 }),
    );

    const promise = runTool(tool, "call-400");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts()).toBe(1);
    expect(isToolResultError(result)).toBe(true);
    expect(result.details).toMatchObject({ status: "error", tool: "tasks_create" });
    expect(result.details).toMatchObject({ error: "Bad request: title is required" });
  });

  it("(c) a permanently rate-limited API still fails within the bounded total backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const promise = executeWithTransientToolRetry(
      async () => {
        attempts += 1;
        throw rateLimitedError(2);
      },
      { label: "tasks_create", idempotent: true, onRetry: (info) => delays.push(info.delayMs) },
    ).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const outcome = await promise;

    expect(attempts).toBe(TRANSIENT_TOOL_RETRY_DEFAULTS.attempts);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain("Rate limit exceeded");
    const total = delays.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(TRANSIENT_TOOL_RETRY_DEFAULTS.maxTotalBackoffMs);
  });

  it("(c2) the adapter surfaces the error result only after the retry budget is spent", async () => {
    const { tool, attempts } = flakyTool(
      "tasks_create",
      Number.POSITIVE_INFINITY,
      () => rateLimitedError(1),
    );

    const promise = runTool(tool, "call-429-permanent");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts()).toBe(TRANSIENT_TOOL_RETRY_DEFAULTS.attempts);
    expect(isToolResultError(result)).toBe(true);
    expect(result.details).toMatchObject({ status: "error", tool: "tasks_create" });
    expect(result.details).toMatchObject({ error: expect.stringContaining("Rate limit") });
  });

  it("(c3) a Retry-After far beyond the budget is clamped, never slept in full", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const promise = executeWithTransientToolRetry(
      async () => {
        attempts += 1;
        throw rateLimitedError(600);
      },
      { label: "tasks_create", idempotent: true, onRetry: (info) => delays.push(info.delayMs) },
    ).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const outcome = await promise;

    // A 600s server request is clamped to the per-delay cap, and the cumulative spend
    // stops before the budget — so the call fails this turn instead of stalling 10 minutes.
    expect(attempts).toBeLessThan(TRANSIENT_TOOL_RETRY_DEFAULTS.attempts);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(TRANSIENT_TOOL_RETRY_DEFAULTS.maxDelayMs);
    }
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(
      TRANSIENT_TOOL_RETRY_DEFAULTS.maxTotalBackoffMs,
    );
    expect(outcome).toBeInstanceOf(Error);
  });

  it("classifies ONLY structured rate-limit signals as transient, never message text", () => {
    expect(isTransientToolFailure(Object.assign(new Error("nope"), { status: 429 }))).toBe(true);
    expect(isTransientToolFailure(Object.assign(new Error("nope"), { response: { status: 429 } }))).toBe(true);
    expect(isTransientToolFailure(Object.assign(new Error("slow"), { retryAfterMs: 100 }))).toBe(true);
    // Message text is NOT a signal: a failed command's output may say anything.
    expect(isTransientToolFailure(new Error("429 Too Many Requests"))).toBe(false);
    expect(isTransientToolFailure(new Error("rate limit exceeded"))).toBe(false);
    expect(isTransientToolFailure(new Error("Command timed out after 30 seconds"))).toBe(false);
    expect(isTransientToolFailure(Object.assign(new Error("t"), { code: "ETIMEDOUT" }))).toBe(false);
    expect(isTransientToolFailure(Object.assign(new Error("nope"), { status: 400 }))).toBe(false);
    expect(isTransientToolFailure(Object.assign(new Error("nope"), { status: 401 }))).toBe(false);
    expect(isTransientToolFailure(Object.assign(new Error("nope"), { statusCode: 402 }))).toBe(
      false,
    );
    expect(isTransientToolFailure(new Error("ENOENT: no such file"))).toBe(false);
  });

  it("reads Retry-After (seconds), X-RateLimit-Reset, and the JSON-body retry_after", () => {
    expect(retryAfterMsFromToolError(rateLimitedError(2))).toBe(2000);

    const fromReset = retryAfterMsFromToolError(
      Object.assign(new Error("Rate limit exceeded."), {
        headers: { "x-ratelimit-reset": String(Date.now() + 5_000) },
      }),
    );
    expect(fromReset ?? 0).toBeGreaterThan(4_000);
    expect(fromReset ?? 0).toBeLessThanOrEqual(5_000);

    // fetch-style Headers object.
    expect(
      retryAfterMsFromToolError(
        Object.assign(new Error("Rate limit exceeded."), {
          headers: new Headers({ "Retry-After": "3" }),
        }),
      ),
    ).toBe(3000);

    // Discord-style JSON-body seconds variant (no header present).
    expect(
      retryAfterMsFromToolError(Object.assign(new Error("429"), { retry_after: 1.5 })),
    ).toBe(1500);

    // Explicit ms from the tool itself wins.
    expect(
      retryAfterMsFromToolError(
        Object.assign(new Error("slow down"), { retryAfterMs: 250, headers: { "Retry-After": "9" } }),
      ),
    ).toBe(250);

    expect(retryAfterMsFromToolError(new Error("plain"))).toBeUndefined();
  });

  it("honours an explicit retryAfterMs when it is below the minimum delay", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const promise = executeWithTransientToolRetry(
      async () => {
        attempts += 1;
        if (attempts <= 1) {
          throw Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 250 });
        }
        return "ok";
      },
      { idempotent: true, onRetry: (info) => delays.push(info.delayMs) },
    );
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(delays).toEqual([TRANSIENT_TOOL_RETRY_DEFAULTS.minDelayMs]);
  });

  it("stops retrying when the call is aborted mid-backoff", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const promise = executeWithTransientToolRetry(
      async () => {
        attempts += 1;
        controller.abort();
        throw rateLimitedError(1);
      },
      { signal: controller.signal, idempotent: true },
    ).catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    expect(attempts).toBe(1);
    expect(await promise).toBeInstanceOf(Error);
  });

  it("never retries a non-idempotent tool, even on a structured 429", async () => {
    const { tool, attempts } = flakyTool("kanban_create", 2, () => rateLimitedError(1), false);

    const promise = runTool(tool, "call-429-mutating");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts()).toBe(1);
    expect(isToolResultError(result)).toBe(true);
  });

  it("never retries exec/write/edit even when mis-flagged idempotent", async () => {
    for (const name of ["exec", "bash", "write", "edit", "apply_patch"]) {
      expect(isRetryableTool({ name, idempotent: true })).toBe(false);
    }
    expect(isRetryableTool({ name: "read", idempotent: true })).toBe(true);
    expect(isRetryableTool({ name: "read" })).toBe(false);

    const { tool, attempts } = flakyTool("exec", 2, () => rateLimitedError(1), true);
    const promise = runTool(tool, "call-exec");
    await vi.runAllTimersAsync();
    await promise;
    expect(attempts()).toBe(1);
  });

  it("does not replay a command that timed out or printed '429' in its output", async () => {
    const { tool, attempts } = flakyTool("web_fetch", 2, (n) =>
      n === 1
        ? new Error("Command timed out after 120 seconds")
        : new Error("HTTP 429 rate limit timeout"),
    );
    const promise = runTool(tool, "call-timeout");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(attempts()).toBe(1);
    expect(isToolResultError(result)).toBe(true);
  });

  it("bounds total WALL time: a slow 429ing attempt stops further retries", async () => {
    let attempts = 0;
    const promise = executeWithTransientToolRetry(
      async () => {
        attempts += 1;
        // Each attempt itself burns 20s before being rate-limited.
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        throw rateLimitedError(1);
      },
      { idempotent: true, maxTotalWallMs: 20_500 },
    ).catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    expect(await promise).toBeInstanceOf(Error);
    expect(attempts).toBe(1);
  });
});
