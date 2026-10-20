/**
 * Transient tool-failure backoff — for IDEMPOTENT tools only.
 *
 * A read-only tool call that fails because the API was RATE-LIMITED must not reach the
 * model as a terminal tool failure: the model re-issues immediately, gets 429'd again, and
 * after N consecutive failed dispatches the turn-ender declares the run exhausted.
 *
 * The retry lives INSIDE a single `tool.execute` invocation (see
 * `tool-definition-adapter.ts`), so the before/after-tool-call hooks and the
 * consecutive-failure guard upstream each observe exactly ONE call with ONE final outcome.
 *
 * Replay safety is the whole contract:
 *  - Only a tool that DECLARES itself idempotent (`AgentTool.idempotent === true`, default
 *    false) is ever retried. `exec` / `write` / `edit` / `apply_patch` / `process` are never
 *    retried even if mis-flagged — a `git push` or a deploy must never run twice.
 *  - Only a STRUCTURED rate-limit signal is retried: `status === 429` (or `statusCode` /
 *    `response.status`) or an explicit `retryAfterMs` / `retryAfter` / `retry_after` field
 *    on the thrown error. The error MESSAGE is never classified: a failed command whose
 *    output mentions "429", "timeout" or "rate limit" is that command's result, not a
 *    transport blip, and timeouts are not retried at all.
 *  - Total WALL time (tool runtime + backoff) is bounded, not just the backoff sleeps.
 *
 * `Retry-After` is read in the shape the gateway already writes
 * (`src/gateway/http-common.ts`, `src/gateway/server-http.ts`: integer SECONDS) and that
 * `src/discord/api.ts` already consumes, with the JSON-body `retry_after` variant alongside.
 */

import { retryAsync, type RetryInfo } from "../infra/retry.js";
import { logDebug } from "../logger.js";
import { normalizeToolName } from "./tool-policy.js";

/**
 * Bounded budget. One initial call plus two retries, never more than ~10s of total backoff
 * and never more than ~30s of wall time (runtime included) inside a single tool call.
 */
export const TRANSIENT_TOOL_RETRY_DEFAULTS = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 8_000,
  maxTotalBackoffMs: 10_000,
  maxTotalWallMs: 30_000,
} as const;

/** Mutating / side-effecting tools that are NEVER replayed, whatever they declare. */
const NEVER_RETRY_TOOL_NAMES = new Set(["exec", "process", "write", "edit", "apply_patch"]);

/** True when this tool may be replayed after a rate-limit rejection. */
export function isRetryableTool(tool: { name?: string; idempotent?: boolean }): boolean {
  if (tool.idempotent !== true) {
    return false;
  }
  return !NEVER_RETRY_TOOL_NAMES.has(normalizeToolName(tool.name ?? ""));
}

function structuredStatus(err: unknown): number | undefined {
  for (const field of ["status", "statusCode"] as const) {
    const value = readErrorField(err, field);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  const response = readErrorField(err, "response");
  const nested = readErrorField(response, "status");
  return typeof nested === "number" && Number.isFinite(nested) ? nested : undefined;
}

function hasExplicitRetryAfter(err: unknown): boolean {
  for (const field of ["retryAfterMs", "retryAfter", "retry_after"] as const) {
    const value = readErrorField(err, field);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return true;
    }
  }
  return false;
}

/**
 * True ONLY for a structured rate-limit rejection (status 429 or an explicit retry-after
 * field). Message text is deliberately ignored — see the module doc.
 */
export function isTransientToolFailure(err: unknown): boolean {
  return structuredStatus(err) === 429 || hasExplicitRetryAfter(err);
}

function readErrorField(err: unknown, name: string): unknown {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  return (err as Record<string, unknown>)[name];
}

/**
 * Read a header from the thrown failure. Accepts a `Headers` instance (fetch shape) or a
 * plain record of headers, case-insensitively — the same two shapes the existing header
 * writers/parsers deal with.
 */
function readHeader(err: unknown, headerName: string): string | undefined {
  const headers = readErrorField(err, "headers");
  if (!headers) {
    return undefined;
  }
  const lower = headerName.toLowerCase();
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as Headers).get(headerName);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return undefined;
  }
  if (typeof headers !== "object") {
    return undefined;
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== lower) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/** Seconds (the header's unit everywhere in this repo) -> ms. Also accepts an HTTP-date. */
function secondsToMs(value: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) {
    return undefined;
  }
  return Math.max(0, at - Date.now());
}

/**
 * `X-RateLimit-Reset` is an absolute reset instant whose unit varies by server (epoch
 * seconds on Discord, epoch millis elsewhere — the platform middleware forwards the
 * sliding-window `resetAt` verbatim), so normalise on magnitude and return the remaining
 * delay in ms.
 */
function resetToRemainingMs(value: string): number | undefined {
  const epochish = /^\d+(\.\d+)?$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(epochish)) {
    return undefined;
  }
  const targetMs = epochish >= 1e12 ? epochish : epochish * 1000;
  return Math.max(0, targetMs - Date.now());
}

/**
 * Extract the server-requested delay (ms) from a thrown tool failure, in the shapes this
 * repo already emits: a `Retry-After` header, the `retry_after` / `retryAfter` seconds
 * fields (`src/discord/api.ts`), an explicit `retryAfterMs`, or `X-RateLimit-Reset`
 * (set by the platform rate limiter on every 429) as a fallback.
 */
export function retryAfterMsFromToolError(err: unknown): number | undefined {
  const explicitMs = readErrorField(err, "retryAfterMs");
  if (typeof explicitMs === "number" && Number.isFinite(explicitMs) && explicitMs >= 0) {
    return explicitMs;
  }

  const retryAfter = readHeader(err, "Retry-After");
  if (retryAfter) {
    const ms = secondsToMs(retryAfter);
    if (ms !== undefined) {
      return ms;
    }
  }

  for (const field of ["retry_after", "retryAfter"] as const) {
    const seconds = readErrorField(err, field);
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  const reset = readHeader(err, "X-RateLimit-Reset");
  if (reset) {
    return resetToRemainingMs(reset);
  }

  return undefined;
}

export type TransientToolRetryOptions = {
  /** Names the tool in retry logs, e.g. the normalized tool name. */
  label?: string;
  /** Aborting stops the backoff immediately instead of sleeping out the budget. */
  signal?: AbortSignal;
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Hard cap on the SUM of all backoff delays inside one turn. */
  maxTotalBackoffMs?: number;
  /** Hard cap on elapsed wall time (runtime + backoff) before another attempt may start. */
  maxTotalWallMs?: number;
  /**
   * The tool declared itself safe to replay (see {@link isRetryableTool}). When false or
   * omitted, `fn` runs exactly once — no retry of any kind.
   */
  idempotent?: boolean;
  onRetry?: (info: RetryInfo) => void;
};

/**
 * Delay `retryAsync` would pick for this attempt. Mirrors its formula (jitter is 0 in
 * `TRANSIENT_TOOL_RETRY_DEFAULTS`, so no jitter term) — the total-budget cap needs to know
 * the next delay BEFORE `retryAsync` sleeps it, and `shouldRetry` is the only hook that
 * runs at that point.
 */
function plannedDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  minDelayMs: number,
  maxDelayMs: number,
): number {
  const base =
    retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
      ? Math.max(retryAfterMs, minDelayMs)
      : minDelayMs * 2 ** (attempt - 1);
  return Math.min(Math.max(base, minDelayMs), maxDelayMs);
}

/**
 * Run `fn`; when `options.idempotent` is true, retry STRUCTURED rate-limit rejections with
 * backoff (honouring `Retry-After`) until the attempt / backoff / wall budget is spent.
 * Everything else propagates on the first attempt, unchanged, so the caller's existing
 * error-result handling is untouched.
 */
export async function executeWithTransientToolRetry<T>(
  fn: () => Promise<T>,
  options: TransientToolRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.round(options.attempts ?? TRANSIENT_TOOL_RETRY_DEFAULTS.attempts));
  const minDelayMs = Math.max(0, Math.round(options.minDelayMs ?? TRANSIENT_TOOL_RETRY_DEFAULTS.minDelayMs));
  const maxDelayMs = Math.max(
    minDelayMs,
    Math.round(options.maxDelayMs ?? TRANSIENT_TOOL_RETRY_DEFAULTS.maxDelayMs),
  );
  const maxTotalBackoffMs = Math.max(
    0,
    Math.round(options.maxTotalBackoffMs ?? TRANSIENT_TOOL_RETRY_DEFAULTS.maxTotalBackoffMs),
  );
  const maxTotalWallMs = Math.max(
    0,
    Math.round(options.maxTotalWallMs ?? TRANSIENT_TOOL_RETRY_DEFAULTS.maxTotalWallMs),
  );

  if (options.idempotent !== true || attempts === 1) {
    return fn();
  }

  const startedAt = Date.now();
  let spentBackoffMs = 0;

  return retryAsync(fn, {
    label: options.label,
    attempts,
    minDelayMs,
    maxDelayMs,
    jitter: 0,
    shouldRetry: (err, attempt) => {
      if (options.signal?.aborted) {
        return false;
      }
      if (!isTransientToolFailure(err)) {
        return false;
      }
      const next = plannedDelayMs(attempt, retryAfterMsFromToolError(err), minDelayMs, maxDelayMs);
      // The budget is the whole point: a dead API fails the call inside this turn. Both
      // the backoff sum AND the elapsed wall time (slow attempts count) are bounded.
      if (spentBackoffMs + next > maxTotalBackoffMs) {
        return false;
      }
      return Date.now() - startedAt + next <= maxTotalWallMs;
    },
    retryAfterMs: retryAfterMsFromToolError,
    onRetry: (info) => {
      spentBackoffMs += info.delayMs;
      logDebug(
        `[tools] retrying transient tool failure: tool=${options.label ?? "tool"} ` +
          `attempt=${info.attempt}/${info.maxAttempts} delay=${info.delayMs}ms ` +
          `spent=${spentBackoffMs}ms error=${errMessage(info.err)}`,
      );
      options.onRetry?.(info);
    },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}