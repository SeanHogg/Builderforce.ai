/**
 * managerSweepCadence — how often the SCHEDULED manager sweep may revisit one project,
 * and when its per-visit telemetry is worth a write. Pure; no I/O.
 *
 * ── WHY A PER-PROJECT INTERVAL ─────────────────────────────────────────────────────
 * The sweep fires every 5-minute tick, and before this every opted-in project with open
 * work got a FULL manager pass on every tick (up to 288 a day) — scoring, ranking, PR
 * conducting, stall triage — dozens of neon-http round trips each, even when nothing on
 * its board had moved since the previous tick five minutes earlier. `project_manager_configs`
 * has no cadence column of its own, so the minimum interval lives here, in one place.
 * It is applied in the candidate SELECT (`loadManagedProjects`), so a project that is not
 * due costs the sweep no queries at all. A manual "Run manager now" calls the pass
 * directly and is never gated.
 */

/**
 * Minimum gap between two SCHEDULED passes on one project, measured from the pass's own
 * `last_run_at` stamp. 15 minutes = 3 ticks: the manager still reacts within a quarter of
 * an hour, at a third of the load. Dispatch latency is unaffected — the autonomous
 * executor, not the manager cron, is the dispatcher of ranked work.
 */
export const MIN_PROJECT_PASS_INTERVAL_MS = 15 * 60_000;

/**
 * How stale `last_sweep_at` may grow while the decision itself is unchanged.
 *
 * `recordSweepDecision` used to UPDATE `project_manager_configs` for every visited
 * project on every tick even when it wrote back the decision and reason already stored.
 * It now writes when the decision or reason CHANGES, plus once per this heartbeat, so
 * `last_sweep_at` still proves the cron is visiting the project (it never trails the
 * real last visit by more than this) without a row write per project per tick.
 */
export const SWEEP_DECISION_HEARTBEAT_MS = 60 * 60_000;

export interface StoredSweepDecision {
  lastSweepDecision: string | null;
  lastSweepReason: string | null;
  lastSweepAt: Date | null;
}

/** True when the sweep's decision about a project is worth persisting. */
export function sweepDecisionNeedsWrite(
  stored: StoredSweepDecision,
  decision: string,
  reason: string | null,
  now: number = Date.now(),
): boolean {
  if (stored.lastSweepDecision !== decision) return true;
  if ((stored.lastSweepReason ?? null) !== reason) return true;
  if (!stored.lastSweepAt) return true;
  return now - new Date(stored.lastSweepAt).getTime() >= SWEEP_DECISION_HEARTBEAT_MS;
}
