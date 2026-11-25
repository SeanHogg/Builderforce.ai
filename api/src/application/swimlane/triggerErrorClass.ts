/**
 * triggerErrorClass — group a thrown autonomous-trigger error into a small, stable
 * vocabulary so `auto_run_error` rows can be counted by cause (AE-04 / AE-G039).
 *
 * PURE. Rules are ordered and the first match wins; a new class is a new entry in
 * {@link RULES}, never a branch at a call site.
 *
 * Class values MUST stay `[a-z_]+`: the autonomy summary extracts them from the
 * serialised `args` JSON with the SQL pattern `"errorClass":"([a-z_]+)"`.
 */
export type TriggerErrorClass = 'cross_request_io' | 'db_transient' | 'refused_client' | 'server_error' | 'unknown';

interface Rule {
  cls: TriggerErrorClass;
  matches: (err: unknown, message: string) => boolean;
}

const statusOf = (err: unknown): number | null => {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : null;
};

const RULES: readonly Rule[] = [
  { cls: 'cross_request_io', matches: (_e, m) => /on behalf of a different request/i.test(m) },
  {
    cls: 'db_transient',
    matches: (_e, m) => /ECONNRESET|connection (terminated|refused|closed)|timeout|too many (clients|connections)|fetch failed/i.test(m),
  },
  { cls: 'refused_client', matches: (e) => { const s = statusOf(e); return s != null && s >= 400 && s < 500; } },
  { cls: 'server_error', matches: (e) => { const s = statusOf(e); return s != null && s >= 500; } },
];

export function classifyTriggerError(err: unknown): TriggerErrorClass {
  const message = err instanceof Error ? err.message : String(err);
  return RULES.find((rule) => rule.matches(err, message))?.cls ?? 'unknown';
}
