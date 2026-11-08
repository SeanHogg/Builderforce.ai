/**
 * redactSecrets — the api's secret-redaction entry point.
 *
 * The patterns, masking rule and structural walk live in `@builderforce/secret-redaction` (the
 * same code agent-runtime runs); this module re-exports them and adds the one api-specific piece,
 * {@link redactAuditRow} — the step every `tool_audit_events` writer runs on its row (see
 * `application/audit/toolAuditWrite.ts`, the only place that inserts).
 *
 * Rules: redact BEFORE truncating ({@link redactThenCap}); a string that may be JSON text (a `result`,
 * `payload` or `args` column) goes through {@link redactJsonText}, never plain text redaction, so the
 * mask cannot break the JSON; a value goes through {@link redactDeep}, then is stringified.
 */
import { redactJsonText } from '@builderforce/secret-redaction';

export { redactDeep, redactJsonText, redactSecrets, redactThenCap, isSecretKey, maskTail } from '@builderforce/secret-redaction';

/**
 * The ONE step every `tool_audit_events` inserter runs on its row before it is stored: `args`
 * (JSON text) is redacted structurally, `result` (text, possibly JSON) likewise. Other fields pass
 * through untouched.
 */
export function redactAuditRow<T extends { args?: unknown; result?: unknown }>(row: T): T {
  // `args` / `result` may also be a SQL expression (an insert value), which is not text and passes through untouched.
  const out: { args?: unknown; result?: unknown } = { ...row };
  if (typeof out.args === 'string') out.args = redactJsonText(out.args, AUDIT_LIMITS);
  if (typeof out.result === 'string') out.result = redactJsonText(out.result, AUDIT_LIMITS);
  return out as T;
}

/** Bounds for a structurally-redacted audit blob: a runaway tool result cannot make the walk (or the row) unbounded. Far above any real arg/result. */
export const AUDIT_LIMITS = { maxString: 100_000, maxEntries: 1_000 } as const;
