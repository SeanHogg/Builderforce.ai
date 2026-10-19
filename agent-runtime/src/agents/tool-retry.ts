/**
 * Transient tool-failure backoff.
 *
 * A tool call that fails because the API was RATE-LIMITED (or the socket blipped) must not
 * reach the model as a terminal tool failure: the model re-issues immediately, gets 429'd
 * again, and after N consecutive failed dispatches the turn-ender declares the run
 * exhausted and emits an empty answer — losing the whole turn, not just the one call.
 *
 * The retry therefore lives INSIDE a single `tool.execute` invocation (see
 * `tool-definition-adapter.ts`), so the before-tool-call hook, the after-tool-call hook
 * and the consecutive-failure guard upstream each observe exactly ONE call with ONE final
 * outcome. The guard is untouched; it simply stops firing on transient blips.
 *
 * Classification is NOT re-implemented here. `resolveFailoverReasonFromError`
 * (`failover-error.ts`) already maps 429 -> "rate_limit" and transport/timeout failures ->
 * "timeout"; only those two reasons are retried, everything else fails fast with zero
 * retries (400 -> "format", 401/403 -> "auth", 402 -> "billing", unknown -> null).
 *
 * `Retry-After` is read in the shape the gateway already writes
 * (`src/gateway/http-common.ts:28-30`, `src/gateway/server-http.ts:165-170`: integer
 * SECONDS) and that `src/discord/api.ts:35-52` already consumes (numeric seconds -> ms),
 * with the JSON-body `retry_after` variant (`DiscordApiError.retryAfter`) alongside it.
 */

import { retryAsync, type RetryInfo } from "../infra/retry.js";
import { logDebug } from "../logger.js";
import { resolveFailoverReasonFromError } from "./failover-error.js";

/**
 * Bounded budget. One initial call plus two retries, and never more than ~10s of total
 * backoff inside a single turn, so a genuinely dead API still fails the call rather than
 * trading one cascade for a hang.
 */
export const TRANSIENT_TOOL_RETRY_DEFAULTS = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 8_000,
  maxTotalBackoffMs: 10_000,
} as const;

/** Failover reasons that are worth another attempt. `format`/`auth`/`billing` are not. */
const TRANSIENT_FAILOVER_REASONS = new Set(["rate_limit", "timeout"]);

/**
 * True when the failure is a transient upstream condition (429 / overload / socket or
 * timeout blip). Reuses the existing classifier — no second error taxonomy here.
 */
export function isTransientToolFailure(err: unknown): boolean {
  const reason = resolveFailoverReasonFromError(err);
  return reason !== null && TRANSIENT_FAILOVER_REASONS.has(reason);
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
 * Run `fn`, retrying TRANSIENT failures with backoff (honouring `Retry-After`) until the
 * budget is spent. Non-transient failures propagate on the first attempt; transient
 * failures that outlive the budget propagate the last error unchanged, so the caller's
 * existing error-result handling is untouched.
 *
 * Replay safety: a 429 is rejected before the work runs, so replaying it is safe. A
 * `timeout`/`ECONNRESET` may in principle have been thrown AFTER a mutating tool did its
 * side effect, so a tool whose replay is not idempotent should throw with an explicit
 * status (or a non-transient reason) rather than a bare transport error. This is the
 * deliberate trade: the alternative — surfacing the blip immediately — costs the whole
 * turn, which is strictly worse than the rare duplicate write.
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
      // The budget is the whole point: a dead API fails the call inside this turn.
      return spentBackoffMs + next <= maxTotalBackoffMs;
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