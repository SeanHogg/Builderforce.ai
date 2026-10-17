/**
 * Gateway failure vocabulary — status predicates, attempt → failover mapping, the
 * rolled-up trace classification, the trace id, and the schema-downgrade recovery.
 *
 * Pure helpers shared by the dispatcher, the envelopes and `finalize`. Split out of
 * `LlmProxyService.ts`, which re-exports the public ones.
 */

import { kindForStatus, vendorForModel, type DispatchAttempt, type VendorFatalError } from './vendors';
import type { ChatCompletionRequest, FailoverEvent } from './proxyTypes';

/** A request-validation status (400/422) — caller-side schema bug. Mirrors the
 *  `request_error` branch in `cooldownStore.classifyFailure`: these write no
 *  cooldown and, when they're the ONLY failure across the cascade, surface as a
 *  fatal 4xx rather than a 429. Single source of truth for the gateway's
 *  "caller's fault, not the model's" status set. */
export function isRequestErrorStatus(status: number): boolean {
  return status === 400 || status === 422;
}

/** An upstream model id that no longer resolves (removed or explicitly gone). */
export function isModelUnavailableStatus(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * Relax a too-complex `response_format.json_schema` to loose `json_object` so a
 * re-dispatch escapes the vendor's constrained-decoding ceiling while still
 * returning JSON — the gateway's auto-recovery for `schema_too_complex` (so a
 * structured feature like resume-tailoring returns a result instead of a terminal
 * 422). Returns a shallow-cloned body, or `null` when there's no strict
 * json_schema to downgrade (a genuine malformed request, or already loose mode).
 *
 * The original schema is appended to `messages` as a SYSTEM hint so the model
 * still targets the expected shape now that the constrained decoder is gone —
 * the caller validates the JSON client-side. Pure + unit-testable.
 */
export function downgradeResponseFormat(body: ChatCompletionRequest): ChatCompletionRequest | null {
  const rf = (body as { response_format?: { type?: string; json_schema?: { schema?: unknown } } }).response_format;
  if (!rf || rf.type !== 'json_schema') return null;
  const clone: ChatCompletionRequest = { ...body, response_format: { type: 'json_object' } };
  const schema = rf.json_schema?.schema;
  if (schema && typeof schema === 'object' && Array.isArray(clone.messages)) {
    clone.messages = [
      ...clone.messages,
      {
        role: 'system',
        content:
          'Respond with a SINGLE JSON object that conforms to this JSON Schema. ' +
          'Output only the JSON — no markdown, no code fences, no prose:\n' +
          JSON.stringify(schema),
      },
    ];
  }
  return clone;
}

/** Synthesize the single `DispatchAttempt` for a `VendorFatalError` (400/422) that
 *  short-circuited the cascade in the vendor dispatcher before it could be recorded
 *  as an attempt. `VendorFatalError` carries the status + message + vendor but NOT
 *  the model id, so the failing model is recovered as the first chain entry owned by
 *  that vendor (earlier entries may have been no-key-skipped) — falling back to the
 *  chain head when none matches. */
export function fatalErrorAttempt(err: VendorFatalError, chain: readonly string[]): DispatchAttempt {
  const model = chain.find((m) => vendorForModel(m) === err.vendorId) ?? chain[0] ?? '';
  const vendor = vendorForModel(model);
  return { model, vendor, status: err.status, error: err.message, durationMs: 0, kind: kindForStatus(err.status, err.message) };
}

export function attemptsToFailovers(attempts: DispatchAttempt[]): FailoverEvent[] {
  return attempts.map(attemptToFailover);
}

/** One {@link DispatchAttempt} → {@link FailoverEvent}, carrying the structured
 *  `reason`/`upstreamStatus` when present so consumers branch on data, not prose.
 *  Single source for both `attemptsToFailovers` and `exhaustedResponse`'s mapper. */
export function attemptToFailover(a: DispatchAttempt): FailoverEvent {
  return {
    model: a.model,
    vendor: a.vendor,
    code: a.status,
    ...(a.durationMs != null ? { durationMs: a.durationMs } : {}),
    ...(a.kind ? { kind: a.kind } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.upstreamStatus != null ? { upstreamStatus: a.upstreamStatus } : {}),
    ...(a.error ? { detail: a.error.slice(0, 240) } : {}),
    ...(a.diagnostic ? { diagnostic: a.diagnostic } : {}),
  };
}

/** Authoritative gateway trace id. Prefix `llm-` mirrors what consumers already
 *  surface as `correlationId`, so a customer can quote it straight back to a
 *  superadmin for lookup. */
export function newTraceId(): string {
  return `llm-${crypto.randomUUID()}`;
}

/** Roll a set of per-attempt `kind`s up into one classification for the trace.
 *  `skipped` attempts (cooldown / no key) don't count toward the class. */
export function classificationFromFailovers(failovers: ReadonlyArray<FailoverEvent>): string {
  const kinds = new Set(
    failovers.map((f) => f.kind).filter((k): k is string => !!k && k !== 'skipped'),
  );
  if (kinds.size === 0) return 'none';
  if (kinds.size === 1) return [...kinds][0]!;
  return 'mixed';
}
