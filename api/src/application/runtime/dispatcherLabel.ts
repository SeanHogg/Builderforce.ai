/**
 * dispatcherLabel — the ONE way to build an `executions.submitted_by` value.
 *
 * WHY THIS EXISTS. `submitted_by` names which subsystem started a run, and the ticket
 * lifecycle ledger reads it to attribute a retry storm to the code responsible. Three
 * call sites in `laneRequirementGate` composed it by raw template —
 * `` `${args.submittedBy}:lane-approver:${approver.roleKey}` `` — against a
 * `varchar(36)` column (widened to 128 in migration 0368). With a base of
 * `system:coordinator` that left three characters for the role key, so any role beyond
 * `qa` produced a Postgres 22001 and threw the reviewer dispatch away entirely.
 *
 * A wider column alone would only move the cliff. This composer keeps the value
 * INSIDE the column by construction, and keeps the truncation intelligible: the
 * SUFFIX is what identifies the specific dispatch (which role, which agent), so when
 * something has to give it is the base that gets clipped, never the detail.
 *
 * Pure — no IO. The bound is exported so the migration, the schema and this module
 * are all pinned to the same number.
 */

/** Must equal `executions.submitted_by`'s varchar width (migration 0368). */
export const MAX_SUBMITTED_BY_CHARS = 128;

/**
 * Compose `<base>:<kind>:<detail>` for `executions.submitted_by`, guaranteed to fit.
 *
 * `kind` and `detail` are preserved whole whenever possible because they answer "what
 * KIND of dispatch, and for whom" — the two facts a stall report is read for. Only if
 * the label still does not fit is it hard-clipped from the right, which cannot happen
 * for any realistic role key.
 */
export function composeDispatcherLabel(base: string, kind: string, detail?: string | null): string {
  const parts = [kind, ...(detail ? [detail] : [])].map((p) => p.trim()).filter(Boolean);
  const suffix = parts.length > 0 ? `:${parts.join(':')}` : '';
  const cleanBase = (base ?? '').trim() || 'system';

  // Keep the whole suffix; give the base whatever room is left (at least nothing).
  const roomForBase = MAX_SUBMITTED_BY_CHARS - suffix.length;
  if (roomForBase >= cleanBase.length) return `${cleanBase}${suffix}`;
  if (roomForBase > 0) return `${cleanBase.slice(0, roomForBase)}${suffix}`;
  // Pathological: the suffix alone overruns the column. Clip from the right — there
  // is no base left to sacrifice, and a truncated label still beats a failed INSERT.
  return suffix.slice(0, MAX_SUBMITTED_BY_CHARS);
}
