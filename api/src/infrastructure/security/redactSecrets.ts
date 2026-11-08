/**
 * Secret redaction for the api / Workers edge runtime.
 *
 * The patterns, masking rule and structural walk live in `@builderforce/secret-redaction` (the
 * same code agent-runtime runs); this module re-exports them and adds the one api-specific piece,
 * {@link redactAuditRow} — the step every `tool_audit_events` writer runs on its row (see
 * `application/audit/toolAuditWrite.ts`, the only place that inserts).
 *
 * Rules: redact BEFORE truncating ({@link redactThenCap}); never run text redaction over a
 * stringified JSON blob (use {@link redactDeep} on the value, then stringify).
 */
import { redactDeep, redactSecrets } from '@builderforce/secret-redaction';

export { redactDeep, redactSecrets, redactThenCap, isSecretKey } from '@builderforce/secret-redaction';

/** Redact JSON text structurally when it parses (keeping its exact form if nothing changed), else as plain text. */
function redactJsonText(text: string): string {
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') return redactSecrets(text);
  try {
    const parsed: unknown = JSON.parse(text);
    const clean = JSON.stringify(redactDeep(parsed));
    return clean === JSON.stringify(parsed) ? text : clean;
  } catch {
    // Not JSON after all (a `[` or `{` that starts prose): the text form is the fail-safe. A redactor must
    // never throw into its caller, and this is an expected outcome, not an error worth reporting.
    return redactSecrets(text);
  }
}

/**
 * The ONE step every `tool_audit_events` inserter runs on its row before it is stored: `args`
 * (JSON text) is redacted structurally, `result` (text, possibly JSON) likewise. Other fields pass
 * through untouched.
 */
export function redactAuditRow<T extends { args?: string | null; result?: string | null }>(row: T): T {
  const out = { ...row };
  if (typeof out.args === 'string') out.args = redactJsonText(out.args);
  if (typeof out.result === 'string') out.result = redactJsonText(out.result);
  return out;
}
