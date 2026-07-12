/**
 * Backlog Burn-Rate Estimator (PRD task #213).
 *
 * Pure calculation engine: given backlog and velocity data, compute estimated
 * agent-hours or human-hours to clear remaining work, with confidence intervals,
 * sensitivity analysis, and risk flags.
 *
 * The math is deliberately transparent (linear) so any stakeholder can
 * understand the reasoning behind the number. All functions are pure —
 * unit-testable without a DB.
 *
 * ## Core formula
 *
 *     Remaining Effort (normalised units)
 *     ─────────────────────────────────── × Hours per Time Unit = Estimated Hours
 *          Velocity (units / time unit)
 *
 * ## Confidence intervals
 *
 * When a time-series of ≥ 3 periods is supplied, the engine uses the standard
 * deviation to compute pessimistic (mean − σ) and optimistic (mean + σ) bounds.
 * With only a single velocity value, a ±20 % default band is applied.
 */

import { clamp } from '../../domain/shared/numbers';

// ---------------------------------------------------------------------------
// Types — each matches a PRD functional requirement
// ---------------------------------------------------------------------------

/** The effort units used for measurement. */
export type EffortUnit = 'story_points' | 'hours' | 'tasks';

/** The time granularity of a velocity reading. */
export type TimeUnit = 'hour' | 'day' | 'week' | 'sprint';

/** One velocity data point (used in a time-series). */
export interface VelocityEntry {
  /** Quantity of work completed (points / hours / tasks). */
  units: number;
  /** Over what period that work was done. */
  timeUnit: TimeUnit;
  /** Which workforce performed the work. */
  track: WorkerTrack;
  /** Optional human-readable label, e.g. "Sprint 14" or "2026-06-15". */
  periodLabel?: string;
}

/** Workforce track. */
export type WorkerTrack = 'agent' | 'human';

/** A single backlog item with an effort estimate and status. */
export interface BacklogItem {
  /** Effort estimate in the normalised unit (nullable when unestimated). */
  effort: number | null;
  /** Current status. */
  status: 'remaining' | 'in_progress' | 'blocked';
  /** Optional human-readable title. */
  title?: string;
}

/** Calendar context for converting hours to calendar dates. */
export interface CalendarContext {
  /** Working hours per day for human workers (e.g. 8). */
  workingHoursPerDay: number;
  /** Uptime hours per day for AI agents (e.g. 24). */
  agentUptimeHoursPerDay: number;
  /** Working days per week (e.g. 5). */
  daysPerWeek: number;
}

/** Velocity input — supports single value, time-series, or dual-track. */
export interface VelocityInput {
  /** A single velocity value when no time-series is available. */
  singleValue?: { units: number; timeUnit: TimeUnit } | null;
  /** A time-series of ≥ 3 periods for variance-based confidence intervals. */
  timeSeries?: VelocityEntry[] | null;
  /** Agent-only velocity (when separated from human track). */
  agent?: { units: number; timeUnit: TimeUnit } | null;
  /** Human-only velocity (when separated from agent track). */
  human?: { units: number; timeUnit: TimeUnit } | null;
}

/** Backlog input — either itemised list or pre-aggregated total. */
export interface BacklogInput {
  /** Itemised backlog list (preferred for risk flags). */
  items?: BacklogItem[] | null;
  /** Pre-aggregated remaining-effort total (alternative to items). */
  totalRemaining?: number | null;
  /** Pre-aggregated blocked effort total. */
  totalBlocked?: number | null;
  /** Pre-aggregated in-progress effort total. */
  totalInProgress?: number | null;
  /** Count of blocked items (for reporting). */
  blockedCount?: number | null;
  /** The effort unit for all entries. */
  unit: EffortUnit;
}

/** Full input to the estimation engine. */
export interface EstimateInput {
  velocity: VelocityInput;
  backlog: BacklogInput;
  /** Calendar context (optional — needed for date estimates). */
  calendar?: CalendarContext | null;
  /** ISO-8601 date string of a target deadline (optional). */
  targetDate?: string | null;
  /** Timestamp anchor (ms since epoch). Defaults to Date.now(). */
  now?: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface FlaggedInsight {
  label: string;
  type: 'warning' | 'info' | 'positive';
  message: string;
}

export interface SensitivityRow {
  label: string;
  velocityMultiplier: number;
  velocityUnitsPerTime: number;
  estimatedHours: number;
  estimatedDate: string | null;
}

export interface EstimateResult {
  /** ISO timestamp of when the estimate was computed. */
  requestedAt: string;

  // ── Backlog summary ──
  /** Total remaining effort (normalised to the input unit). */
  backlogSize: number;
  /** Effort from blocked items that is at risk. */
  blockedHoursAtRisk: number;
  /** Human-readable flagged insights (warnings / info / positives). */
  flaggedInsights: FlaggedInsight[];

  // ── Velocity metadata ──
  velocitySource: 'single' | 'time_series' | 'dual_track';
  /** Number of velocity periods available (0 for single). */
  velocityPeriods: number;
  /** Computed expected velocity in units per hour. */
  velocityUnitsPerHour: number;
  /** Label for the time unit, e.g. "hour", "day", "sprint". */
  velocityTimeUnit: string;

  // ── Track separation (dual-track mode) ──
  agentVelocity: number | null;
  agentEstimatedHours: number | null;
  humanVelocity: number | null;
  humanEstimatedHours: number | null;

  // ── Core estimates (hours) ──
  pessimisticHours: number;
  expectedHours: number;
  optimisticHours: number;

  // ── Calendar estimate ──
  estimatedCompletionDate: string | null;

  // ── Confidence ──
  confidence: 'Low' | 'Medium' | 'High';

  // ── Assumptions ──
  assumptions: string[];

  // ── Sensitivity ──
  sensitivity: SensitivityRow[];
  /** The velocity (units/hour) needed to hit the target deadline. */
  breakEvenVelocity: number | null;
  /** Whether current velocity meets or exceeds the break-even. */
  currentVelocitySufficient: boolean | null;

  // ── WIP risk ──
  /** Percentage of remaining effort that is in-progress. */
  inProgressEffortPct: number;
  /** True when in-progress effort > 30 % of remaining. */
  inProgressWarning: boolean;

  // ── Human-readable markdown summary ──
  markdownSummary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MILLIS_PER_DAY = 86_400_000;
const DEFAULT_CONFIDENCE_BAND = 0.20; // ±20 % when only a single velocity value
const WIP_WARNING_THRESHOLD = 0.30;   // 30 %
// AC-2/AC-6: at least 3 periods are required before the estimate can be labelled
// Medium or High; anything below that is Low confidence by definition.
const MIN_PERIODS_FOR_MEDIUM_CONFIDENCE = 3;
const MIN_PERIODS_FOR_HIGH_CONFIDENCE = 3;
const BLOCKED_RATIO_FLAG = 0.10;      // 10 % blocked triggers a flag

/** Multipliers for the sensitivity table (FR-5). */
const SENSITIVITY_MULTIPLIERS: Array<{ label: string; multiplier: number }> = [
  { label: '-25 %', multiplier: 0.75 },
  { label: '-10 %', multiplier: 0.90 },
  { label: '+10 %', multiplier: 1.10 },
  { label: '+25 %', multiplier: 1.25 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a TimeUnit to its length in hours. */
export function timeUnitToHours(unit: TimeUnit): number {
  switch (unit) {
    case 'hour':   return 1;
    case 'day':    return 8;    // standard working day
    case 'week':   return 40;   // 5 × 8-hour days
    case 'sprint': return 160;  // 4 × 40-hour weeks (typical 2-week sprint is 80h, 4-week is 160h)
  }
}

/**
 * Normalise any TimeUnit to hours.
 * A "sprint" is treated as 160 hours (4 weeks × 40 h/wk).
 */
export function normaliseToHours(
  units: number,
  fromUnit: TimeUnit,
): number {
  return units * timeUnitToHours(fromUnit);
}

/**
 * Flatten a velocity time-series into per-hour rates.
 * Returns the list of units-per-hour values.
 */
export function velocitySeriesPerHour(series: VelocityEntry[]): number[] {
  if (!series || series.length === 0) return [];
  return series.map((v) => {
    const raw = v.units / timeUnitToHours(v.timeUnit);
    return raw;
  });
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length <= 1) return 0;
  const sqDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

/**
 * Compute the backlog burn-rate estimate.
 *
 * Pure function (no side effects, no I/O) — pass in structured data, get back
 * the full estimate result.
 */
export function estimateBacklogBurnRate(input: EstimateInput): EstimateResult {
  const now = input.now ?? Date.now();
  const requestedAt = new Date(now).toISOString();

  const assumptions: string[] = [];
  const flaggedInsights: FlaggedInsight[] = [];

  // ── 1. Parse backlog ────────────────────────────────────────────────
  const { backlogSize, blockedEffort, inProgressEffort, insightWarnings: backlogWarnings } =
    parseBacklog(input.backlog);
  assumptions.push(...backlogWarnings.assumptions);
  flaggedInsights.push(...backlogWarnings.insights);

  const inProgressEffortPct = backlogSize > 0
    ? clamp((inProgressEffort / backlogSize) * 100, 0, 100)
    : 0;
  const inProgressWarning = inProgressEffortPct > WIP_WARNING_THRESHOLD * 100;

  // ── 2. Parse velocity ───────────────────────────────────────────────
  const velocity = parseVelocity(input.velocity, assumptions, flaggedInsights);

  const velocitySource = velocity.source;
  const velocityPeriods = velocity.periods;
  const velocityUnitsPerHour = velocity.expectedPerHour;
  const velocityTimeUnit = velocity.label;

  // Dual-track
  let agentVelocity: number | null = null;
  let agentEstimatedHours: number | null = null;
  let humanVelocity: number | null = null;
  let humanEstimatedHours: number | null = null;

  if (input.velocity.agent && input.velocity.human) {
    const agentRate = normaliseUnitsPerHour(input.velocity.agent.units, input.velocity.agent.timeUnit);
    const humanRate = normaliseUnitsPerHour(input.velocity.human.units, input.velocity.human.timeUnit);
    agentVelocity = agentRate;
    humanVelocity = humanRate;

    if (agentRate > 0 && humanRate > 0) {
      const totalRate = agentRate + humanRate;
      agentEstimatedHours = backlogSize / totalRate;
      humanEstimatedHours = backlogSize / totalRate;
      assumptions.push(`Agent and human velocities supplied separately and combined for total throughput.`);
    }
  }

  // ── 3. Core estimate ────────────────────────────────────────────────
  if (velocityUnitsPerHour <= 0) {
    // No velocity signal — return a degenerated result.
    const degen = degeneratedResult(backlogSize, blockedEffort, inProgressEffortPct, inProgressWarning,
      velocitySource, velocityPeriods, velocityUnitsPerHour, velocityTimeUnit,
      agentVelocity, agentEstimatedHours, humanVelocity, humanEstimatedHours,
      assumptions, flaggedInsights, requestedAt);
    return degen;
  }

  const expectedHours = backlogSize / velocityUnitsPerHour;

  // Confidence intervals
  const pessimisticVelocity = Math.max(velocityUnitsPerHour * 0.01, velocity.pessimisticPerHour);
  const optimisticVelocity = velocity.optimisticPerHour;
  const pessimisticHours = backlogSize / pessimisticVelocity;
  const optimisticHours = backlogSize / optimisticVelocity;

  // ── 4. Calendar estimate (FR-3) ─────────────────────────────────────
  let estimatedCompletionDate: string | null = null;
  const calendar = input.calendar;
  if (calendar) {
    // Use working hours per day for humans or agent uptime for agents
    const effectiveHoursPerDay = humanVelocity != null
      ? calendar.workingHoursPerDay
      : calendar.agentUptimeHoursPerDay;
    const daysToComplete = expectedHours / effectiveHoursPerDay;
    const completionMs = now + daysToComplete * MILLIS_PER_DAY;
    estimatedCompletionDate = new Date(completionMs).toISOString().slice(0, 10);
    assumptions.push(`Calendar estimate uses ${effectiveHoursPerDay} hours/day, ${calendar.daysPerWeek} days/week.`);
  }

  // ── 5. Blocked hours at risk (FR-6) ────────────────────────────────
  const blockedHoursAtRisk = velocityUnitsPerHour > 0
    ? blockedEffort / velocityUnitsPerHour
    : 0;

  // ── 6. Confidence level (FR-3 / AC-2 / AC-6) ────────────────────────
  const confidence = computeConfidence(
    velocityPeriods,
    inProgressEffortPct,
    blockedEffort / Math.max(1, backlogSize),
  );

  // ── 7. Sensitivity analysis (FR-5) ──────────────────────────────────
  const sensitivity = SENSITIVITY_MULTIPLIERS.map(({ label, multiplier }) => {
    const v = velocityUnitsPerHour * multiplier;
    const h = v > 0 ? backlogSize / v : Infinity;
    const d = calendar && h !== Infinity
      ? new Date(now + (h / effectiveHoursPerDay(calendar, humanVelocity != null)) * MILLIS_PER_DAY)
          .toISOString().slice(0, 10)
      : null;
    return { label, velocityMultiplier: multiplier, velocityUnitsPerTime: v, estimatedHours: h, estimatedDate: d };
  }) as SensitivityRow[];

  // ── 8. Break-even velocity (FR-5) ───────────────────────────────────
  let breakEvenVelocity: number | null = null;
  let currentVelocitySufficient: boolean | null = null;
  if (input.targetDate) {
    const targetMs = new Date(input.targetDate).getTime();
    const availableMs = targetMs - now;
    if (availableMs > 0) {
      const effectiveHpd = effectiveHoursPerDay(
        calendar ?? { workingHoursPerDay: 8, agentUptimeHoursPerDay: 24, daysPerWeek: 5 },
        humanVelocity != null,
      );
      const availableHours = (availableMs / MILLIS_PER_DAY) * effectiveHpd;
      breakEvenVelocity = backlogSize / Math.max(availableHours, 1);
      currentVelocitySufficient = velocityUnitsPerHour >= breakEvenVelocity;
    }
  }

  // ── 9. Assemble result ──────────────────────────────────────────────

  const result: EstimateResult = {
    requestedAt,
    backlogSize,
    blockedHoursAtRisk,
    flaggedInsights,
    velocitySource,
    velocityPeriods,
    velocityUnitsPerHour,
    velocityTimeUnit,
    agentVelocity,
    agentEstimatedHours,
    humanVelocity,
    humanEstimatedHours,
    pessimisticHours: round2(pessimisticHours),
    expectedHours: round2(expectedHours),
    optimisticHours: round2(optimisticHours),
    estimatedCompletionDate,
    confidence,
    assumptions,
    sensitivity,
    breakEvenVelocity: breakEvenVelocity != null ? round2(breakEvenVelocity) : null,
    currentVelocitySufficient,
    inProgressEffortPct: round2(inProgressEffortPct),
    inProgressWarning,
    markdownSummary: '',
  };

  result.markdownSummary = buildMarkdown(result, input);

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseBacklog(backlog: BacklogInput): {
  backlogSize: number;
  blockedEffort: number;
  inProgressEffort: number;
  insightWarnings: { assumptions: string[]; insights: FlaggedInsight[] };
} {
  const assumptions: string[] = [];
  const insights: FlaggedInsight[] = [];

  let backlogSize = 0;
  let blockedEffort = 0;
  let inProgressEffort = 0;

  if (backlog.items && backlog.items.length > 0) {
    for (const item of backlog.items) {
      const e = item.effort ?? 0;
      if (item.status === 'blocked') {
        blockedEffort += e;
      } else if (item.status === 'in_progress') {
        inProgressEffort += e;
        backlogSize += e;
      } else {
        backlogSize += e;
      }
    }

    const blockedCount = backlog.items.filter((i) => i.status === 'blocked').length;
    if (blockedCount > 0) {
      insights.push({
        label: 'Blocked Items',
        type: 'warning',
        message: `${blockedCount} item(s) blocked (${round2(blockedEffort)} ${backlog.unit}). These are excluded from the default estimate and reported separately.`,
      });
    }

    const inProgressPct = backlogSize > 0 ? (inProgressEffort / backlogSize) * 100 : 0;
    if (inProgressPct > 30) {
      insights.push({
        label: 'High WIP',
        type: 'warning',
        message: `In-progress items represent ${round2(inProgressPct)} % of remaining effort — risk of context switching overhead.`,
      });
    }

    assumptions.push(`Backlog derived from ${backlog.items.length} itemised entries.`);
  } else if (backlog.totalRemaining != null) {
    backlogSize = backlog.totalRemaining;
    blockedEffort = backlog.totalBlocked ?? 0;
    inProgressEffort = backlog.totalInProgress ?? 0;
    assumptions.push('Backlog entered as pre-aggregated total (no per-item breakdown).');
  }

  if (backlogSize < 0) backlogSize = 0;

  return {
    backlogSize,
    blockedEffort,
    inProgressEffort,
    insightWarnings: { assumptions, insights },
  };
}

function parseVelocity(
  velocity: VelocityInput,
  assumptions: string[],
  insights: FlaggedInsight[],
): {
  source: 'single' | 'time_series' | 'dual_track';
  periods: number;
  expectedPerHour: number;
  pessimisticPerHour: number;
  optimisticPerHour: number;
  label: string;
} {
  // Dual-track first — if agent and human are both supplied.
  if (velocity.agent && velocity.human) {
    const agentRate = normaliseUnitsPerHour(velocity.agent.units, velocity.agent.timeUnit);
    const humanRate = normaliseUnitsPerHour(velocity.human.units, velocity.human.timeUnit);
    const combined = agentRate + humanRate;
    assumptions.push(`Dual-track velocity: agent ${round2(agentRate)} + human ${round2(humanRate)} = ${round2(combined)} units/hour combined.`);
    return {
      source: 'dual_track',
      periods: 2,
      expectedPerHour: combined,
      pessimisticPerHour: combined * (1 - DEFAULT_CONFIDENCE_BAND),
      optimisticPerHour: combined * (1 + DEFAULT_CONFIDENCE_BAND),
      label: velocity.agent.timeUnit,
    };
  }

  // Time-series
  if (velocity.timeSeries && velocity.timeSeries.length >= 1) {
    const series = velocitySeriesPerHour(velocity.timeSeries);
    const avg = mean(series);
    const sd = stdDev(series, avg);
    const n = velocity.timeSeries.length;

    if (n < 3) {
      insights.push({
        label: 'Low Confidence',
        type: 'warning',
        message: `Velocity data spans only ${n} period(s). At least 3 periods are recommended for a reliable estimate.`,
      });
    }

    assumptions.push(`Velocity computed from ${n} period(s) of time-series data. Mean: ${round2(avg)} units/hour, σ: ${round2(sd)}.`);

    return {
      source: 'time_series',
      periods: n,
      expectedPerHour: avg,
      pessimisticPerHour: avg - sd,
      optimisticPerHour: avg + sd,
      label: velocity.timeSeries[0]!.timeUnit,
    };
  }

  // Single value
  if (velocity.singleValue) {
    const rate = normaliseUnitsPerHour(velocity.singleValue.units, velocity.singleValue.timeUnit);
    assumptions.push(`Velocity provided as a single value: ${round2(rate)} units/hour (±${DEFAULT_CONFIDENCE_BAND * 100} % default band).`);
    insights.push({
      label: 'Low Confidence',
      type: 'warning',
      message: `Only a single velocity value supplied. At least 3 time-series periods are recommended for a reliable estimate. Using ±${DEFAULT_CONFIDENCE_BAND * 100} % default band.`,
    });
    return {
      source: 'single',
      periods: 1,
      expectedPerHour: rate,
      pessimisticPerHour: rate * (1 - DEFAULT_CONFIDENCE_BAND),
      optimisticPerHour: rate * (1 + DEFAULT_CONFIDENCE_BAND),
      label: velocity.singleValue.timeUnit,
    };
  }

  // No velocity data at all
  assumptions.push('No velocity data supplied — estimate is undefined.');
  return {
    source: 'single',
    periods: 0,
    expectedPerHour: 0,
    pessimisticPerHour: 0,
    optimisticPerHour: 0,
    label: 'unknown',
  };
}

function normaliseUnitsPerHour(units: number, timeUnit: TimeUnit): number {
  return units / timeUnitToHours(timeUnit);
}

/**
 * Grade the estimate's confidence (AC-2 / AC-6).
 *
 * - Fewer than 3 velocity periods → always **Low** (insufficient data).
 * - ≥ 3 periods with clean data (low WIP, low blocked ratio) → **High**.
 * - ≥ 3 periods but with WIP or blocked risk → **Medium**.
 */
function computeConfidence(
  periods: number,
  inProgressPct: number,
  blockedRatio: number,
): 'Low' | 'Medium' | 'High' {
  if (periods < MIN_PERIODS_FOR_MEDIUM_CONFIDENCE) {
    return 'Low';
  }
  if (
    periods >= MIN_PERIODS_FOR_HIGH_CONFIDENCE &&
    inProgressPct <= WIP_WARNING_THRESHOLD * 100 &&
    blockedRatio <= BLOCKED_RATIO_FLAG
  ) {
    return 'High';
  }
  return 'Medium';
}

function effectiveHoursPerDay(calendar: CalendarContext, isHumanTrack: boolean): number {
  return isHumanTrack ? calendar.workingHoursPerDay : calendar.agentUptimeHoursPerDay;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function degeneratedResult(
  backlogSize: number,
  blockedEffort: number,
  inProgressEffortPct: number,
  inProgressWarning: boolean,
  velocitySource: 'single' | 'time_series' | 'dual_track',
  velocityPeriods: number,
  velocityUnitsPerHour: number,
  velocityTimeUnit: string,
  agentVelocity: number | null,
  agentEstimatedHours: number | null,
  humanVelocity: number | null,
  humanEstimatedHours: number | null,
  assumptions: string[],
  flaggedInsights: FlaggedInsight[],
  requestedAt: string,
): EstimateResult {
  return {
    requestedAt,
    backlogSize,
    blockedHoursAtRisk: 0,
    flaggedInsights: [
      ...flaggedInsights,
      { label: 'No Velocity', type: 'warning', message: 'Cannot compute estimate: velocity is zero or missing.' },
    ],
    velocitySource,
    velocityPeriods,
    velocityUnitsPerHour: 0,
    velocityTimeUnit,
    agentVelocity,
    agentEstimatedHours,
    humanVelocity,
    humanEstimatedHours,
    pessimisticHours: Infinity,
    expectedHours: Infinity,
    optimisticHours: Infinity,
    estimatedCompletionDate: null,
    confidence: 'Low',
    assumptions,
    sensitivity: [],
    breakEvenVelocity: null,
    currentVelocitySufficient: null,
    inProgressEffortPct: round2(inProgressEffortPct),
    inProgressWarning,
    markdownSummary: '⚠️ **Cannot compute estimate.** Velocity is zero or missing — provide velocity data to generate a backlog burn-rate forecast.',
  };
}

// ---------------------------------------------------------------------------
// Markdown report builder (FR-4)
// ---------------------------------------------------------------------------

function buildMarkdown(result: EstimateResult, input: EstimateInput): string {
  const lines: string[] = [];
  const unit = input.backlog.unit.replace(/_/g, ' ');

  lines.push('# 📊 Backlog Burn-Rate Estimate\n');
  lines.push(`**Generated:** ${result.requestedAt.replace('T', ' ').slice(0, 19)} UTC\n`);

  // Summary card
  lines.push('## Summary\n');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Remaining backlog | ${result.backlogSize} ${unit} |`);
  lines.push(`| Velocity (expected) | ${round2(result.velocityUnitsPerHour)} ${unit}/hour |`);
  lines.push(`| Velocity source | ${result.velocitySource.replace('_', ' ')} (${result.velocityPeriods} period(s)) |`);
  lines.push(`| **Expected hours** | **${formatHours(result.expectedHours)}** |`);
  lines.push(`| Pessimistic hours | ${formatHours(result.pessimisticHours)} |`);
  lines.push(`| Optimistic hours | ${formatHours(result.optimisticHours)} |`);
  lines.push(`| Confidence | ${result.confidence} |`);

  if (result.estimatedCompletionDate) {
    lines.push(`| Estimated completion | ${result.estimatedCompletionDate} |`);
  }

  // Dual-track
  if (result.agentEstimatedHours != null || result.humanEstimatedHours != null) {
    lines.push('\n## Workforce Breakdown\n');
    lines.push(`| Track | Velocity (units/hour) | Estimated Hours |`);
    lines.push(`|---|---|---|`);
    if (result.agentVelocity != null) {
      lines.push(`| AI Agent | ${round2(result.agentVelocity)} | ${formatHours(result.agentEstimatedHours)} |`);
    }
    if (result.humanVelocity != null) {
      lines.push(`| Human | ${round2(result.humanVelocity)} | ${formatHours(result.humanEstimatedHours)} |`);
    }
  }

  // Sensitivity
  if (result.sensitivity.length > 0) {
    lines.push('\n## Sensitivity Analysis\n');
    lines.push('How the estimate changes if velocity shifts:\n');
    lines.push(`| Scenario | Velocity (${unit}/hour) | Estimated Hours | Completion Date |`);
    lines.push(`|---|---|---|---|`);
    for (const row of result.sensitivity) {
      const h = isFinite(row.estimatedHours) ? formatHours(row.estimatedHours) : '∞';
      lines.push(`| ${row.label} | ${round2(row.velocityUnitsPerTime)} | ${h} | ${row.estimatedDate ?? '—'} |`);
    }
    if (result.breakEvenVelocity != null) {
      lines.push(`\n**Break-even velocity** to meet target: **${round2(result.breakEvenVelocity)}** ${unit}/hour`);
      lines.push(`Current velocity is **${result.currentVelocitySufficient ? 'sufficient ✅' : 'insufficient ❌'}** to meet the deadline.`);
    }
  }

  // Blocked and at risk
  if (result.blockedHoursAtRisk > 0) {
    lines.push('\n## 🚧 Blocked Work at Risk\n');
    lines.push(`${formatHours(result.blockedHoursAtRisk)} of blocked effort is excluded from the main estimate.`);
  }

  // WIP warning
  if (result.inProgressWarning) {
    lines.push('\n## ⚠️ WIP Risk\n');
    lines.push(`In-progress items represent **${round2(result.inProgressEffortPct)}%** of remaining effort — above the 30 % threshold. Consider limiting WIP to reduce context-switching overhead.`);
  }

  // Assumptions
  lines.push('\n## Assumptions\n');
  lines.push(result.assumptions.map((a) => `- ${a}`).join('\n'));

  // Insights
  if (result.flaggedInsights.length > 0) {
    lines.push('\n## Insights\n');
    for (const ins of result.flaggedInsights) {
      const icon = ins.type === 'warning' ? '⚠️' : ins.type === 'info' ? 'ℹ️' : '✅';
      lines.push(`- ${icon} **${ins.label}:** ${ins.message}`);
    }
  }

  return lines.join('\n');
}

function formatHours(h: number): string {
  if (!isFinite(h) || h < 0) return '∞';
  if (h < 1) return `${round2(h * 60)} min`;
  if (h < 24) return `${round2(h)} h`;
  const days = h / 8;
  return `${round2(h)} h (${round2(days)} days)`;
}
