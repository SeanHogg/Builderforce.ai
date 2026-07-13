import { BuilderforceApiError } from '../infrastructure/httpClient';

/**
 * Coarse, stable error class for a failed gateway call — keyed off the gateway's
 * OWN failure taxonomy (`error.code` + `terminal` + the failover breakdown), NOT
 * raw HTTP-status guessing. Branch on this instead of reinventing a classifier
 * per consumer (which inevitably drifts).
 *
 *   rate_limit          — the gateway's whole cascade was rate-limited (429
 *                         `cascade_exhausted`). Retry later (`retryAfter`).
 *   token_cap           — a per-TENANT cap was hit (plan/monthly/host/claw token
 *                         or image-credit limit). TERMINAL for this billing
 *                         window — a different model won't help.
 *   schema_too_complex  — every candidate rejected the `response_format.json_schema`
 *                         as too complex for its constrained-decoding engine.
 *                         TERMINAL: simplify the schema or drop to `json_object`.
 *   invalid_request     — malformed payload (400/422) every model rejected. TERMINAL.
 *   auth                — bad/missing API key (401/403). TERMINAL.
 *   model_unavailable   — a strict-pinned model is on cooldown / unconfigured (503).
 *                         Not terminal: drop the pin or pick another model.
 *   timeout             — the request (or a single vendor attempt) timed out (408).
 *   service_unavailable — infrastructure ceiling (503 `worker_subrequest_exhausted`)
 *                         or transient upstream outage (5xx). Retry after a backoff.
 *   content_filter      — a safety system blocked the generation.
 *   network             — the request never reached the gateway (DNS/TLS/reset).
 *   aborted             — the caller's AbortSignal fired (499 / AbortError).
 *   unknown             — none of the above matched.
 */
export type ErrorKind =
  | 'rate_limit'
  | 'token_cap'
  | 'schema_too_complex'
  | 'invalid_request'
  | 'auth'
  | 'model_unavailable'
  | 'timeout'
  | 'service_unavailable'
  | 'content_filter'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface ErrorClassification {
  kind: ErrorKind;
  /**
   * `true` when retrying the SAME request on a DIFFERENT model will NOT help —
   * the consumer's own failover chain should short-circuit. Sourced from the
   * gateway's `error.terminal` flag when present, with a kind-based fallback.
   */
  terminal: boolean;
  /**
   * `true` when the SAME request is safe to retry as-is (idempotently), usually
   * after `retryAfter` seconds — e.g. a transient rate-limit/outage/timeout.
   * `false` for deterministic rejections (schema, invalid request, auth, caps).
   */
  retryable: boolean;
  /** Seconds the caller should wait before retrying, when the gateway supplied it. */
  retryAfter?: number;
  /** HTTP status, when the error reached the gateway. */
  status?: number;
  /** Gateway error code slug, when present (`schema_too_complex`, `plan_token_limit_exceeded`, …). */
  code?: string;
  /** Human-readable message (the gateway's, or the thrown error's). */
  message: string;
}

/** Tenant-cap codes — all per-tenant (not per-model), so all TERMINAL for the window. */
const TOKEN_CAP_CODES: ReadonlySet<string> = new Set([
  'plan_token_limit_exceeded',
  'plan_monthly_token_limit_exceeded',
  'agent_host_token_limit_exceeded',
  'claw_token_limit_exceeded',
  'image_credit_limit_exceeded',
]);

/**
 * Classify any caught error from a Builderforce SDK call into a structured,
 * actionable verdict. Accepts `unknown` so a consumer can pass a raw `catch`
 * binding — non-`BuilderforceApiError` values (network throws, `AbortError`,
 * plain `Error`) are classified too.
 *
 * This is the FIRST-PARTY classifier the gateway feedback asked for: keyed off
 * the gateway's own taxonomy so every consumer agrees on what "terminal" and
 * "retryable" mean instead of hand-rolling `429/408/401/5xx → kind` guesses that
 * drift apart.
 */
export function classifyError(err: unknown): ErrorClassification {
  // ── Non-gateway throws ────────────────────────────────────────────────────
  if (!(err instanceof BuilderforceApiError)) {
    const name = (err as { name?: unknown } | null)?.name;
    const message = err instanceof Error ? err.message : String(err);
    if (name === 'AbortError') {
      return { kind: 'aborted', terminal: true, retryable: false, message };
    }
    // A TypeError from fetch (failed to fetch / network) never reached the gateway.
    if (err instanceof TypeError) {
      return { kind: 'network', terminal: false, retryable: true, message };
    }
    return { kind: 'unknown', terminal: false, retryable: false, message };
  }

  const { status, code, terminal, retryAfter, message } = err;
  const base = {
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(code !== undefined ? { code } : {}),
    message,
  };

  // ── Code-slug routing (authoritative — the gateway's own taxonomy) ─────────
  if (code === 'schema_too_complex' || lastFailoverReason(err) === 'schema_too_complex') {
    return { kind: 'schema_too_complex', terminal: terminal ?? true, retryable: false, ...base };
  }
  if (code && TOKEN_CAP_CODES.has(code)) {
    return { kind: 'token_cap', terminal: terminal ?? true, retryable: false, ...base };
  }
  if (code === 'model_unavailable') {
    return { kind: 'model_unavailable', terminal: terminal ?? false, retryable: false, ...base };
  }
  if (code === 'worker_subrequest_exhausted') {
    return { kind: 'service_unavailable', terminal: false, retryable: true, ...base };
  }
  if (code === 'aborted') {
    return { kind: 'aborted', terminal: true, retryable: false, ...base };
  }
  if (code === 'content_filter') {
    return { kind: 'content_filter', terminal: terminal ?? true, retryable: false, ...base };
  }

  // ── Status routing (fallback when no specific code applies) ────────────────
  if (status === 408 || code === 'timeout') {
    return { kind: 'timeout', terminal: false, retryable: true, ...base };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', terminal: terminal ?? true, retryable: false, ...base };
  }
  if (status === 429) {
    return { kind: 'rate_limit', terminal: terminal ?? false, retryable: !(terminal ?? false), ...base };
  }
  if (status === 400 || status === 422) {
    return { kind: 'invalid_request', terminal: terminal ?? true, retryable: false, ...base };
  }
  if (status === 503) {
    return { kind: 'service_unavailable', terminal: false, retryable: true, ...base };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'service_unavailable', terminal: false, retryable: true, ...base };
  }

  return { kind: 'unknown', terminal: terminal ?? false, retryable: false, ...base };
}

/** The `reason` slug of the last cascade attempt, if any — lets `classifyError`
 *  recognise a schema rejection on an older gateway that set the failover `reason`
 *  but not the top-level `code`. */
function lastFailoverReason(err: BuilderforceApiError): string | undefined {
  const f = err.failovers;
  if (!f || f.length === 0) return undefined;
  return f[f.length - 1]?.reason;
}
