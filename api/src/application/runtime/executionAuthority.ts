/**
 * WHO SAID THIS RUN MAY HAPPEN — the authority a dispatch carries when it is not a
 * stage role doing stage work.
 *
 * ── THE PROBLEM THIS RESOLVES ────────────────────────────────────────────────
 * A lifecycle-managed board accepts only role-attributed executions
 * (`authorizeManagedTaskExecution`): the payload must name an `actAsRole` the stage
 * authorizes. That is the right rule for PRODUCTION work, because the thing it
 * protects is the accountability manifest — who owes this stage, and what advanced it.
 *
 * It was applied to everything, and two whole classes of run are not production work:
 *
 *  1. A PERSON DIRECTING EXECUTION. From the VS Code client the user cannot see whether
 *     a board is lifecycle-managed and cannot change its configuration — the board type
 *     is not a concept that surface exposes. They click Run, or tell the agent to
 *     dispatch, and the platform answered with a refusal about a role vocabulary they
 *     have no way to satisfy. A human with dispatch permission directing a run IS the
 *     authority; refusing them is not governance, it is a dead end.
 *  2. PLATFORM MACHINERY. A compile/deploy, a security audit, a validation pass, an
 *     incident triage, a CI auto-fix — none of these is a role's deliverable, so asking
 *     which stage role a security audit "performs" is a category error. They were
 *     refused on every managed board, silently until the previous pass and visibly but
 *     still uselessly after it.
 *
 * ── WHAT AN OVERRIDE COSTS, AND WHY THIS ONE COSTS NOTHING ───────────────────
 * Letting these run must not become a hole in the control. What the managed guard
 * actually defends is that a stage advances only on a recorded verdict from a role
 * accountable for it — so an admitted run is made LIFECYCLE-NEUTRAL: it executes, it
 * reports, and it may not move the ticket's lane or satisfy a manifest slot. The
 * sign-off gate is exactly as closed after it as before.
 *
 * And an override is never anonymous: the authority names WHO (a user id, or the
 * service) and WHY, travels on the payload for the life of the run, and is recorded
 * against the ticket when the guard admits it. "A person overrode the managed gate" is
 * a fact the board can show, not an inference from an absence.
 *
 * Pure JSON in / JSON out — no IO, no DB, trivially testable. Follows the marker-module
 * convention already used by `incidentTriageMarker` / `validatorReviewMarker`.
 */

/** A human directing execution, or the platform running its own machinery. */
export type ExecutionAuthorityKind = 'human' | 'system';

export interface ExecutionAuthority {
  kind: ExecutionAuthorityKind;
  /** WHO: the user id for `human`, the service name for `system`. Never blank. */
  by: string;
  /** WHY, in the caller's own words — this is what an auditor reads. */
  reason: string;
}

/** A person with dispatch permission directed this run. */
export function humanDirected(by: string | null | undefined, reason: string): ExecutionAuthority {
  // An unattributable human override is a contradiction — the whole point is that
  // someone is accountable for it — so an absent id degrades to a named placeholder
  // rather than an empty string that reads as "nobody".
  return { kind: 'human', by: by?.trim() || 'unknown-user', reason };
}

/** The platform started this run itself (compile, security, validation, CI auto-fix, …). */
export function systemInitiated(service: string, reason: string): ExecutionAuthority {
  return { kind: 'system', by: service.trim() || 'system', reason };
}

/** Merge an authority onto a dispatch payload, preserving everything already on it. */
export function stampExecutionAuthority(payload: string | undefined, authority: ExecutionAuthority): string {
  let base: Record<string, unknown> = {};
  if (payload) {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      // A non-JSON payload is not a shape this contract can extend. Starting fresh
      // would DISCARD the caller's instructions, so the authority is dropped instead
      // and the guard simply refuses as it did before — a lost override, never a lost
      // payload.
      return payload;
    }
  }
  return JSON.stringify({ ...base, runAuthority: authority });
}

/** The authority a run was dispatched under, or null for an ordinary role/lane run. */
export function parseExecutionAuthority(payload: string | null | undefined): ExecutionAuthority | null {
  if (!payload) return null;
  try {
    const raw = (JSON.parse(payload) as { runAuthority?: unknown }).runAuthority;
    if (!raw || typeof raw !== 'object') return null;
    const { kind, by, reason } = raw as Record<string, unknown>;
    if (kind !== 'human' && kind !== 'system') return null;
    if (typeof by !== 'string' || !by.trim()) return null;
    return { kind, by, reason: typeof reason === 'string' ? reason : '' };
  } catch {
    return null;
  }
}

/**
 * Mark a run as unable to advance the ticket's lifecycle.
 *
 * Stamped by the DISPATCHER, not the caller, and only when the managed guard actually
 * admitted the run without a role — the one place that knows both "this board is
 * managed" and "this run carries no stage attribution". A caller cannot set it (it
 * would be a caller deciding its own governance) and a run on an unmanaged board is
 * never marked, so nothing that worked before changes.
 */
export function markLifecycleNeutral(payload: string | undefined): string {
  let base: Record<string, unknown> = {};
  if (payload) {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      return payload;
    }
  }
  return JSON.stringify({ ...base, lifecycleNeutral: true });
}

/**
 * True when this run may NOT move the ticket's lane on completion.
 *
 * Read by `RuntimeService` alongside the reviewer / incident-triage / role-run holds it
 * already applies: all of them run against an already-open ticket whose progression
 * belongs to something other than the run finishing.
 */
export function isLifecycleNeutralRun(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    return (JSON.parse(payload) as { lifecycleNeutral?: unknown }).lifecycleNeutral === true;
  } catch {
    return false;
  }
}

/**
 * The audit `toolName` written when a managed board admits a run on an authority rather
 * than a role. Its own name, never reused: "the gate was overridden, deliberately, by
 * this person or service" is a distinct fact from any dispatch outcome, and an operator
 * reviewing a managed board must be able to list exactly these.
 */
export const MANAGED_OVERRIDE_EVENT = 'managed.gate_override';

/** One line for an audit row / activity summary. */
export function describeAuthority(authority: ExecutionAuthority): string {
  const who = authority.kind === 'human' ? `user ${authority.by}` : `system service '${authority.by}'`;
  return authority.reason ? `${who}: ${authority.reason}` : who;
}
