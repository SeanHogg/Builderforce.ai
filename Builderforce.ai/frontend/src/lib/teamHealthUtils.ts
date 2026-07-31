/**
 * Team Health Dashboard — pure utility functions.
 *
 * Health score computation, WIP aging calculation, capacity overload
 * determination, and alert deduplication are all stateless pure functions
 * so they can be tested independently of the UI and reused on the server.
 */

import type {
  AgentHealth,
  AgingWip,
  Blocker,
  Contributor,
  HealthAlert,
  HealthScoreConfig,
  HealthTask,
} from './teamHealthTypes';

/* ── Defaults (mirrors the PRD) ──────────────────────────────────────────── */

export const DEFAULT_HEALTH_CONFIG: HealthScoreConfig = {
  weights: { blockers: 0.4, overload: 0.3, aging: 0.2, agentErrors: 0.1 },
  thresholds: {
    taskAgingDays: 3,
    epicAgingDays: 7,
    overloadWarningPct: 120,
    overloadCriticalPct: 150,
    agentIdleQueueThresholdMin: 15,
    blockerAgeThresholds: { urgent: 24, high: 72 },
  },
};

/* ── Health Score ────────────────────────────────────────────────────────── */

export interface HealthScoreResult {
  overall: number;
  components: {
    blockers: number;   // 0–1 (0 = good)
    overload: number;   // 0–1
    aging: number;      // 0–1
    agentErrors: number;// 0–1
  };
  config: HealthScoreConfig;
}

/**
 * Compute the Team Health Score (0–100) from raw metrics.
 *
 * Each component is a 0..1 value where 1 = worst health.
 * The overall score is 100 * (1 - weighted_sum), clamped to [0, 100].
 */
export function computeHealthScore(
  blockerCount: number,
  overloadPct: number,
  agingWipCount: number,
  agentErrorRate: number,
  config: HealthScoreConfig = DEFAULT_HEALTH_CONFIG,
): HealthScoreResult {
  const { weights, thresholds } = config;

  // Blockers: normalise against a soft ceiling of 10
  const blockersNorm = clamp(blockerCount / 10, 0, 1);

  // Overload: 0 at 100%, 1 at thresholds.overloadCriticalPct
  const overloadNorm = clamp(
    (overloadPct - 100) / (thresholds.overloadCriticalPct - 100),
    0,
    1,
  );

  // Aging WIP: normalise against a soft ceiling of 15
  const agingNorm = clamp(agingWipCount / 15, 0, 1);

  // Agent errors: rate is already 0..1
  const agentErrorsNorm = clamp(agentErrorRate, 0, 1);

  const components = {
    blockers: blockersNorm,
    overload: overloadNorm,
    aging: agingNorm,
    agentErrors: agentErrorsNorm,
  };

  const weighted =
    weights.blockers * components.blockers +
    weights.overload * components.overload +
    weights.aging * components.aging +
    weights.agentErrors * components.agentErrors;

  const overall = Math.round(clamp(100 * (1 - weighted), 0, 100));

  return { overall, components, config };
}

/* ── Capacity & Workload ─────────────────────────────────────────────────── */

export interface OverloadInfo {
  pct: number;
  level: 'ok' | 'warning' | 'critical';
}

export function computeOverload(
  assignedLoad: number,
  capacity: number,
  config: HealthScoreConfig = DEFAULT_HEALTH_CONFIG,
): OverloadInfo {
  if (capacity <= 0) return { pct: 0, level: 'ok' };
  const pct = Math.round((assignedLoad / capacity) * 100);
  const level =
    pct >= config.thresholds.overloadCriticalPct
      ? 'critical'
      : pct >= config.thresholds.overloadWarningPct
        ? 'warning'
        : 'ok';
  return { pct, level };
}

/* ── Aging WIP ───────────────────────────────────────────────────────────── */

export function computeStaleness(
  task: HealthTask,
  now: number = Date.now(),
  config: HealthScoreConfig = DEFAULT_HEALTH_CONFIG,
): AgingWip | null {
  // Intentionally paused items are suppressed
  if (task.intentionallyPaused) {
    if (task.pauseExpiresAt && task.pauseExpiresAt > now) return null;
    // if no expiry, treat as permanently paused
    if (!task.pauseExpiresAt) return null;
  }

  // Only in-progress tasks can be aging WIP
  if (task.status !== 'in_progress') return null;

  const lastActivity = task.lastActivityAt ?? 0;
  const staleMs = now - lastActivity;
  const staleDays = staleMs / (1000 * 60 * 60 * 24);

  // Determine threshold based on task type (story points hint at epic size)
  const thresholdDays = (task.storyPoints ?? 0) >= 8
    ? config.thresholds.epicAgingDays
    : config.thresholds.taskAgingDays;

  if (staleDays < thresholdDays) return null;

  const ageInThresholds = Math.min(
    Math.floor(staleDays / thresholdDays),
    3,
  );

  return {
    task,
    ageInThresholds: Math.max(1, ageInThresholds),
    staleDays: Math.round(staleDays * 10) / 10,
  };
}

/* ── Blockers ────────────────────────────────────────────────────────────── */

export function buildBlocker(
  task: HealthTask,
  now: number = Date.now(),
): Blocker | null {
  if (task.status !== 'blocked') return null;
  const blockedSince = task.blockedSince ?? now;
  const ageMs = now - blockedSince;
  const ageHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;
  return {
    task,
    ageHours,
    blocking: {
      what: task.blockingNote ?? null,
      who: task.assigneeName ?? null,
    },
  };
}

/* ── Alert deduplication ─────────────────────────────────────────────────── */

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per FR-6.3

/**
 * Returns true if an alert with the same type and resourceId was already fired
 * within the 1-hour cooldown window at the same or higher severity.
 */
export function shouldSuppressAlert(
  alert: HealthAlert,
  recentAlerts: HealthAlert[],
  now: number = Date.now(),
): boolean {
  return recentAlerts.some(
    (a) =>
      a.type === alert.type &&
      a.resourceId === alert.resourceId &&
      a.severity === alert.severity &&
      now - a.timestamp < ALERT_COOLDOWN_MS,
  );
}

/* ── Agent error rate ────────────────────────────────────────────────────── */

export function computeAgentErrorRate(agents: AgentHealth[]): number {
  if (agents.length === 0) return 0;
  const errored = agents.filter((a) => a.agentStatus === 'error').length;
  return errored / agents.length;
}

/* ── CSV export (FR-3.5) ─────────────────────────────────────────────────── */

export function agingWipToCsv(items: AgingWip[]): string {
  const header = 'Task ID,Title,Assignee,Status,Days Since Activity,Severity\n';
  const severityLabel = (a: AgingWip) =>
    a.ageInThresholds === 1 ? 'Yellow' : a.ageInThresholds === 2 ? 'Orange' : 'Red';
  const rows = items.map((a) =>
    [
      a.task.id,
      csvEscape(a.task.title),
      csvEscape(a.task.assigneeName ?? 'Unassigned'),
      a.task.status,
      a.staleDays,
      severityLabel(a),
    ].join(','),
  );
  return header + rows.join('\n');
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
