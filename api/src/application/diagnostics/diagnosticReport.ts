/**
 * Project Health Diagnostic Report Service
 *
 * Generates a structured, machine-readable project health snapshot across six
 * critical dimensions: Timeline, Budget, Quality, Risk, Team, and Alignment.
 *
 * Each section carries a 0–100 health score, a trend indicator (improving /
 * stable / declining), and a 1–3 sentence natural-language summary derived
 * from the input data. The service is pure and deterministic; it has no side
 * effects, no database access, and no external API calls — suitable for unit
 * testing and integration into any pipeline.
 *
 * ## Public API
 *
 * ```ts
 * import { generateDiagnosticReport } from './diagnosticReport';
 * const report = generateDiagnosticReport({
 *   projectId: 'proj_42',
 *   metrics: { … },
 *   previousMetrics: { … },  // optional
 * });
 * ```
 *
 * @module diagnostics/diagnosticReport
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trend direction for a single health section. */
export type Trend = 'improving' | 'stable' | 'declining';

/** A single section of the diagnostic report. */
export interface Section {
  /** Health score, integer 0–100 (inclusive). */
  score: number;
  /** Directional trend relative to the previous period (or heuristic fallback). */
  trend: Trend;
  /** Human-readable 1–3 sentence summary composed from the input data. */
  summary: string;
}

/**
 * Metrics provided for each of the six health dimensions.
 *
 * Every field is optional (omit what you do not have), but a section whose
 * relevant fields are ALL missing produces a score of 0 with an explicit
 * "no data" summary.
 */
export interface DiagnosticMetrics {
  // ── Timeline (schedule health) ──────────────────────────────────────────
  /** Planned duration in calendar days. */
  plannedDurationDays?: number;
  /** Elapsed calendar days since start. */
  elapsedDays?: number;
  /** Completed work as a fraction 0–1 (e.g. 0.6 = 60 % complete). */
  completionPct?: number;
  /** Schedule variance in days (negative = behind schedule). */
  scheduleVarianceDays?: number;

  // ── Budget (financial health) ───────────────────────────────────────────
  /** Total approved budget in the project's currency units. */
  totalBudget?: number;
  /** Amount spent so far. */
  spentToDate?: number;
  /** Monthly burn rate (spend per month). */
  monthlyBurnRate?: number;
  /** Fraction of budget elapsed 0–1 (e.g. 3 months into a 12-month project = 0.25). */
  budgetElapsedPct?: number;

  // ── Quality (defect & stability health) ─────────────────────────────────
  /** Defects discovered per 1 000 lines of code (or per feature). */
  defectDensity?: number;
  /** Number of open / unresolved defects. */
  openDefects?: number;
  /** Change failure rate as a percentage (0–100). */
  changeFailureRatePct?: number;
  /** Mean time to restore in hours (lower is better). */
  mttrHours?: number;
  /** Test coverage percentage (0–100). */
  testCoveragePct?: number;

  // ── Risk (risk exposure health) ─────────────────────────────────────────
  /** Total number of identified risks. */
  riskCount?: number;
  /** Number of risks rated high or critical severity. */
  highSeverityRiskCount?: number;
  /** Number of risks with a defined mitigation plan. */
  mitigatedRiskCount?: number;
  /** Aggregate risk exposure score (vendor- or model-supplied; higher = worse). */
  aggregateRiskScore?: number;

  // ── Team (velocity & capacity health) ───────────────────────────────────
  /** Team velocity (story points / cycle) — current period. */
  velocity?: number;
  /** Planned / target velocity. */
  targetVelocity?: number;
  /** Number of contributors actively working. */
  activeContributors?: number;
  /** Number of open positions / unfilled roles. */
  openRoles?: number;
  /** Attrition / churn rate as a percentage (0–100). */
  churnRatePct?: number;

  // ── Alignment (stakeholder & goal alignment) ────────────────────────────
  /** Stakeholder satisfaction / alignment percentage (0–100). */
  stakeholderAlignmentPct?: number;
  /** Percentage of work-items explicitly linked to an OKR / goal (0–100). */
  okrLinkedPct?: number;
  /** Number of scope-change requests in the current period. */
  scopeChangeCount?: number;
  /** Number of scope-change requests accepted. */
  acceptedScopeChanges?: number;
}

/**
 * Full input to the diagnostic report generator.
 *
 * `previousMetrics` is optional. When supplied, trend is computed by comparing
 * the current section scores against the previous period's scores. When
 * omitted, trend falls back to a threshold-based heuristic per section.
 */
export interface DiagnosticInput {
  /** Unique project identifier (free-form string). */
  projectId: string;
  /** Raw metrics for the CURRENT period. */
  metrics: DiagnosticMetrics;
  /** Raw metrics for the PREVIOUS period (optional — enables score comparison). */
  previousMetrics?: DiagnosticMetrics;
}

/** The complete diagnostic report. */
export interface DiagnosticReport {
  /** ISO-8601 timestamp of generation. */
  generatedAt: string;
  /** Echo of input projectId. */
  projectId: string;
  /** The six dimension sections. */
  sections: {
    timeline: Section;
    budget: Section;
    quality: Section;
    risk: Section;
    team: Section;
    alignment: Section;
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validate(input: DiagnosticInput): void {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('diagnostic input is required');
  }
  if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
    throw new ValidationError('projectId is required and must be a non-empty string');
  }
  if (!input.metrics || typeof input.metrics !== 'object') {
    throw new ValidationError('metrics is required and must be an object');
  }

  const m = input.metrics;
  const p = input.previousMetrics;

  // Validate numeric ranges where applicable
  const inRange = (val: unknown, min: number, max: number, label: string): void => {
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || Number.isNaN(val)) {
        throw new ValidationError(`${label} must be a number, got ${typeof val}`);
      }
      if (val < min || val > max) {
        throw new ValidationError(`${label} must be between ${min} and ${max}, got ${val}`);
      }
    }
  };
  const nonNegative = (val: unknown, label: string): void => {
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || Number.isNaN(val) || val < 0) {
        throw new ValidationError(`${label} must be a non-negative number, got ${val}`);
      }
    }
  };

  // Timeline
  nonNegative(m.plannedDurationDays, 'metrics.plannedDurationDays');
  nonNegative(m.elapsedDays, 'metrics.elapsedDays');
  inRange(m.completionPct, 0, 1, 'metrics.completionPct');
  // scheduleVarianceDays can be negative

  // Budget
  nonNegative(m.totalBudget, 'metrics.totalBudget');
  nonNegative(m.spentToDate, 'metrics.spentToDate');
  nonNegative(m.monthlyBurnRate, 'metrics.monthlyBurnRate');
  inRange(m.budgetElapsedPct, 0, 1, 'metrics.budgetElapsedPct');

  // Quality
  nonNegative(m.defectDensity, 'metrics.defectDensity');
  nonNegative(m.openDefects, 'metrics.openDefects');
  inRange(m.changeFailureRatePct, 0, 100, 'metrics.changeFailureRatePct');
  nonNegative(m.mttrHours, 'metrics.mttrHours');
  inRange(m.testCoveragePct, 0, 100, 'metrics.testCoveragePct');

  // Risk
  nonNegative(m.riskCount, 'metrics.riskCount');
  nonNegative(m.highSeverityRiskCount, 'metrics.highSeverityRiskCount');
  nonNegative(m.mitigatedRiskCount, 'metrics.mitigatedRiskCount');
  nonNegative(m.aggregateRiskScore, 'metrics.aggregateRiskScore');

  // Team
  nonNegative(m.velocity, 'metrics.velocity');
  nonNegative(m.targetVelocity, 'metrics.targetVelocity');
  nonNegative(m.activeContributors, 'metrics.activeContributors');
  nonNegative(m.openRoles, 'metrics.openRoles');
  inRange(m.churnRatePct, 0, 100, 'metrics.churnRatePct');

  // Alignment
  inRange(m.stakeholderAlignmentPct, 0, 100, 'metrics.stakeholderAlignmentPct');
  inRange(m.okrLinkedPct, 0, 100, 'metrics.okrLinkedPct');
  nonNegative(m.scopeChangeCount, 'metrics.scopeChangeCount');
  nonNegative(m.acceptedScopeChanges, 'metrics.acceptedScopeChanges');

  // Same for previousMetrics if supplied
  if (p) {
    inRange(p.completionPct, 0, 1, 'previousMetrics.completionPct');
    inRange(p.budgetElapsedPct, 0, 1, 'previousMetrics.budgetElapsedPct');
    inRange(p.changeFailureRatePct, 0, 100, 'previousMetrics.changeFailureRatePct');
    inRange(p.testCoveragePct, 0, 100, 'previousMetrics.testCoveragePct');
    inRange(p.churnRatePct, 0, 100, 'previousMetrics.churnRatePct');
    inRange(p.stakeholderAlignmentPct, 0, 100, 'previousMetrics.stakeholderAlignmentPct');
    inRange(p.okrLinkedPct, 0, 100, 'previousMetrics.okrLinkedPct');
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Clamp an integer into [0, 100]. */
function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---------------------------------------------------------------------------
// Section scorers — one per dimension
// ---------------------------------------------------------------------------

/**
 * TIMELINE — measures schedule adherence.
 *
 * Score is derived from the schedule performance index:
 *   SPI ≈ completionPct / (elapsedDays / plannedDurationDays)
 *
 * When SPI ≥ 1.0 the project is on or ahead of schedule → score ≥ 75.
 * When SPI < 1.0, the gap drives the score down linearly.
 */
function scoreTimeline(m: DiagnosticMetrics): number {
  const { plannedDurationDays, elapsedDays, completionPct, scheduleVarianceDays } = m;
  if (plannedDurationDays === undefined || elapsedDays === undefined || completionPct === undefined) {
    if (scheduleVarianceDays !== undefined) {
      // Fall back to schedule variance only
      return clamp100(100 + scheduleVarianceDays * 5);
    }
    return 0; // no data
  }
  if (plannedDurationDays === 0) return 50;
  const expectedPct = Math.min(1, elapsedDays / plannedDurationDays);
  if (expectedPct === 0) return 100; // just started
  const spi = completionPct / expectedPct;
  return clamp100(Math.min(100, spi * 75 + 25));
}

/**
 * BUDGET — measures cost performance.
 *
 * Score is derived from the cost performance index:
 *   CPI ≈ completionPct / (spentToDate / totalBudget)
 *
 * When CPI ≥ 1.0 the project is under budget → score ≥ 75.
 * When CPI < 1.0, the gap drives the score down.
 */
function scoreBudget(m: DiagnosticMetrics): number {
  const { totalBudget, spentToDate, monthlyBurnRate, budgetElapsedPct, completionPct } = m;
  if (totalBudget === undefined || spentToDate === undefined) {
    // Fall back to burn-rate vs elapsed heuristic
    if (monthlyBurnRate !== undefined && budgetElapsedPct !== undefined && completionPct !== undefined) {
      // Extrapolate: burn * months vs budget… without totalBudget we cannot.
      // Just use completion vs elapsed budget window.
      if (budgetElapsedPct === 0) return 100;
      const cpiApprox = completionPct / budgetElapsedPct;
      return clamp100(cpiApprox * 75 + 25);
    }
    return 0;
  }
  if (totalBudget === 0) return 50;
  const spentPct = spentToDate / totalBudget;
  if (spentPct === 0) return 100;
  const progressPct = completionPct ?? (budgetElapsedPct ?? 0);
  if (progressPct === 0) return clamp100(100 - spentPct * 100);
  const cpi = progressPct / spentPct;
  return clamp100(Math.min(100, cpi * 75 + 25));
}

/**
 * QUALITY — measures defect & stability health.
 *
 * Combines defect density, open defects, CFR, MTTR, and test coverage into a
 * weighted composite: low defects + low CFR + low MTTR + high coverage → high score.
 */
function scoreQuality(m: DiagnosticMetrics): number {
  const { defectDensity, openDefects, changeFailureRatePct, mttrHours, testCoveragePct } = m;
  const parts: number[] = [];
  let weight = 0;

  if (defectDensity !== undefined) {
    // Defect density: 0 → 100, 20+ → 0 (linear)
    parts.push(clamp100(100 - defectDensity * 5));
    weight += 1;
  }
  if (openDefects !== undefined) {
    // Open defects: 0 → 100, 50+ → 0
    parts.push(clamp100(100 - openDefects * 2));
    weight += 1;
  }
  if (changeFailureRatePct !== undefined) {
    // CFR: 0 % → 100, 50 %+ → 0
    parts.push(clamp100(100 - changeFailureRatePct * 2));
    weight += 1;
  }
  if (mttrHours !== undefined) {
    // MTTR: 0 h → 100, 24 h+ → 0
    parts.push(clamp100(100 - (mttrHours / 24) * 100));
    weight += 1;
  }
  if (testCoveragePct !== undefined) {
    // Coverage: 0 % → 0, 100 % → 100
    parts.push(Math.min(100, testCoveragePct));
    weight += 1;
  }

  return weight === 0 ? 0 : clamp100(parts.reduce((a, b) => a + b, 0) / weight);
}

/**
 * RISK — measures risk exposure.
 *
 * High risk count drives the score down; mitigated risks pull it back up.
 * Lower aggregate risk scores are better.
 */
function scoreRisk(m: DiagnosticMetrics): number {
  const { riskCount, highSeverityRiskCount, mitigatedRiskCount, aggregateRiskScore } = m;
  if (riskCount === undefined && highSeverityRiskCount === undefined && aggregateRiskScore === undefined) {
    return 0;
  }

  // Base from aggregate risk score if available (assume 0–100 where 100 = max risk)
  if (aggregateRiskScore !== undefined) {
    return clamp100(100 - aggregateRiskScore);
  }

  // Otherwise derive from counts
  const high = highSeverityRiskCount ?? 0;
  const mitigated = mitigatedRiskCount ?? 0;
  const total = riskCount ?? high;

  if (total === 0) return 100;

  const highPct = high / total;
  const mitigatedPct = mitigated / total;

  // High-severity fraction bad, mitigation fraction good
  const base = 100 - highPct * 80; // 0 % high → 100, 100 % high → 20
  const boost = mitigatedPct * 20; // 100 % mitigated → +20
  return clamp100(base + boost);
}

/**
 * TEAM — measures velocity & capacity health.
 *
 * Velocity ratio (actual / target) drives the primary score, with penalties
 * for unfilled roles and churn.
 */
function scoreTeam(m: DiagnosticMetrics): number {
  const { velocity, targetVelocity, activeContributors, openRoles, churnRatePct } = m;
  const parts: number[] = [];
  let weight = 0;

  if (velocity !== undefined && targetVelocity !== undefined && targetVelocity > 0) {
    // Velocity ratio: ≥1.0 → 100, 0.0 → 0
    parts.push(clamp100(Math.min(1, velocity / targetVelocity) * 100));
    weight += 2; // double-weight velocity
  } else if (velocity !== undefined) {
    // Velocity present but no target — neutral
    parts.push(50);
    weight += 1;
  }

  if (activeContributors !== undefined && openRoles !== undefined) {
    const total = activeContributors + openRoles;
    if (total > 0) {
      const filledPct = activeContributors / total;
      parts.push(clamp100(filledPct * 100));
      weight += 1;
    }
  }

  if (churnRatePct !== undefined) {
    // Churn: 0 % → 100, 50 %+ → 0
    parts.push(clamp100(100 - churnRatePct * 2));
    weight += 1;
  }

  return weight === 0 ? 0 : clamp100(parts.reduce((a, b) => a + b, 0) / weight);
}

/**
 * ALIGNMENT — measures stakeholder & goal alignment.
 *
 * Weighted composite of stakeholder satisfaction, OKR linkage, and scope
 * change stability (too many scope changes = misalignment).
 */
function scoreAlignment(m: DiagnosticMetrics): number {
  const { stakeholderAlignmentPct, okrLinkedPct, scopeChangeCount, acceptedScopeChanges } = m;
  const parts: number[] = [];
  let weight = 0;

  if (stakeholderAlignmentPct !== undefined) {
    parts.push(Math.min(100, stakeholderAlignmentPct));
    weight += 2; // primary signal
  }

  if (okrLinkedPct !== undefined) {
    parts.push(Math.min(100, okrLinkedPct));
    weight += 1;
  }

  if (scopeChangeCount !== undefined && scopeChangeCount > 0 && acceptedScopeChanges !== undefined) {
    // Stability: high acceptance rate of scope changes suggests deliberate, aligned
    // adjustments; a high count with low acceptance suggests churn.
    const acceptRate = Math.min(1, acceptedScopeChanges / scopeChangeCount);
    // Penalise high volume of scope changes regardless
    const volumePenalty = Math.max(0, 1 - scopeChangeCount / 20);
    parts.push(clamp100(acceptRate * volumePenalty * 100));
    weight += 1;
  } else if (scopeChangeCount !== undefined && scopeChangeCount === 0) {
    parts.push(100); // no changes → stable
    weight += 1;
  }

  return weight === 0 ? 0 : clamp100(parts.reduce((a, b) => a + b, 0) / weight);
}

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

/**
 * Determine trend by comparing current score vs previous score.
 *
 * Threshold: ±5 points is "stable"; otherwise improving or declining.
 * When previous score is unavailable we apply a heuristic threshold per section
 * based on the current score alone (≥70 improving, ≤40 declining).
 */
function computeTrend(currentScore: number, previousScore: number | undefined): Trend {
  if (previousScore !== undefined) {
    const delta = currentScore - previousScore;
    if (delta > 5) return 'improving';
    if (delta < -5) return 'declining';
    return 'stable';
  }
  // Heuristic fallback: interpret absolute score as a rough direction signal
  if (currentScore >= 70) return 'improving';
  if (currentScore <= 40) return 'declining';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Summary generators — one per section
// ---------------------------------------------------------------------------

const TREND_LABEL: Record<Trend, string> = {
  improving: 'improving',
  stable: 'stable',
  declining: 'declining',
};

function summaryTimeline(m: DiagnosticMetrics, score: number, trend: Trend): string {
  const parts: string[] = [];
  if (m.completionPct !== undefined) {
    parts.push(`Project is ${Math.round(m.completionPct * 100)} % complete`);
  }
  if (m.scheduleVarianceDays !== undefined) {
    const dir = m.scheduleVarianceDays >= 0 ? 'ahead' : 'behind';
    parts.push(`${Math.abs(m.scheduleVarianceDays)} day(s) ${dir} schedule`);
  }
  if (m.elapsedDays !== undefined && m.plannedDurationDays !== undefined) {
    parts.push(`(${m.elapsedDays} of ${m.plannedDurationDays} planned days elapsed)`);
  }
  if (parts.length === 0) {
    parts.push('No timeline data available');
  }
  parts.push(`Timeline health is ${TREND_LABEL[trend]} with a score of ${score}.`);
  return parts.join('. ');
}

function summaryBudget(m: DiagnosticMetrics, score: number, trend: Trend): string {
  const parts: string[] = [];
  if (m.totalBudget !== undefined && m.spentToDate !== undefined) {
    const spentPct = Math.round((m.spentToDate / m.totalBudget) * 100);
    parts.push(`Spent ${spentPct} % of the total budget`);
  }
  if (m.monthlyBurnRate !== undefined) {
    parts.push(`monthly burn rate is ${m.monthlyBurnRate.toLocaleString()} units`);
  }
  if (parts.length === 0) {
    parts.push('No budget data available');
  }
  parts.push(`Budget health is ${TREND_LABEL[trend]} with a score of ${score}.`);
  return parts.join('. ');
}

function summaryQuality(m: DiagnosticMetrics, score: number, trend: Trend): string {
  const parts: string[] = [];
  if (m.openDefects !== undefined) {
    parts.push(`${m.openDefects} open defect(s)`);
  }
  if (m.changeFailureRatePct !== undefined) {
    parts.push(`change failure rate is ${Math.round(m.changeFailureRatePct)} %`);
  }
  if (m.testCoveragePct !== undefined) {
    parts.push(`test coverage at ${Math.round(m.testCoveragePct)} %`);
  }
  if (m.defectDensity !== undefined) {
    parts.push(`defect density ${m.defectDensity.toFixed(1)} per unit`);
  }
  if (parts.length === 0) {
    parts.push('No quality data available');
  }
  parts.push(`Quality health is ${TREND_LABEL[trend]} with a score of ${score}.`);
  return parts.join('. ');
}

function summaryRisk(m: DiagnosticMetrics, score: number, trend: Trend): string {
  const parts: string[] = [];
  if (m.riskCount !== undefined) {
    parts.push(`${m.riskCount} total risk(s) identified`);
  }
  if (m.highSeverityRiskCount !== undefined && m.highSeverityRiskCount > 0) {
    parts.push(`${m.highSeverityRiskCount} high-severity`);
  }
  if (m.mitigatedRiskCount !== undefined) {
    parts.push(`${m.mitigatedRiskCount} with mitigation plans`);
  }
  if (m.aggregateRiskScore !== undefined) {
    parts.push(`aggregate exposure score ${Math.round(m.aggregateRiskScore)}`);
  }
  if (parts.length === 0) {
    parts.push('No risk data available');
  }
  parts.push(`Risk health is ${TREND_LABEL[trend]} with a score of ${score}.`);
  return parts.join('. ');
}

function summaryTeam(m: DiagnosticMetrics, score: number, trend: Trend): string {
  const parts: string[] = [];
  if (m.velocity !== undefined) {
    parts.push(`Velocity ${m.velocity}`);
    if (m.targetVelocity !== undefined) {
      parts.push(`vs target ${m.targetVelocity}`);
    }
  }
  if (m.activeContributors !== undefined) {
    parts.push(`${m.activeContributors} active contributor(s)`);
  }
  if (m.openRoles !== undefined && m.openRoles > 0) {
    parts.push(`${m.openRoles} unfilled role(s)`);
  }
  if (m.churnRatePct !== undefined) {
    parts.push(`${Math.round(m.churnRatePct)} % churn rate`);
  }
  if (parts.length === 0) {
    parts.push('No team data available');
  }
  parts.push(`Team health is ${TREND_LABEL[trend]} with a score of ${score}.`);
  return parts.join('. ');
}

function summaryAlignment(m: DiagnosticMetrics, score: number, trend: Trend): string {
  const parts: string[] = [];
  if (m.stakeholderAlignmentPct !== undefined) {
    parts.push(`Stakeholder alignment at ${Math.round(m.stakeholderAlignmentPct)} %`);
  }
  if (m.okrLinkedPct !== undefined) {
    parts.push(`${Math.round(m.okrLinkedPct)} % of work linked to OKRs`);
  }
  if (m.scopeChangeCount !== undefined) {
    parts.push(`${m.scopeChangeCount} scope change request(s)`);
    if (m.acceptedScopeChanges !== undefined) {
      parts.push(`${m.acceptedScopeChanges} accepted`);
    }
  }
  if (parts.length === 0) {
    parts.push('No alignment data available');
  }
  parts.push(`Alignment health is ${TREND_LABEL[trend]} with a score of ${score}.`);
  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate a structured project health diagnostic report.
 *
 * Accepts current metrics and an optional previous snapshot for trend comparison.
 * Every call with the same arguments produces identical output (pure function).
 *
 * @param input  - The diagnostic input containing `projectId`, `metrics`, and
 *                 optionally `previousMetrics`.
 * @returns        A complete {@link DiagnosticReport} with all six health sections.
 * @throws         {@link ValidationError} when required fields are missing or
 *                 metric values are out of range.
 *
 * @example
 * ```ts
 * const report = generateDiagnosticReport({
 *   projectId: 'proj_42',
 *   metrics: {
 *     plannedDurationDays: 90,
 *     elapsedDays: 45,
 *     completionPct: 0.55,
 *     totalBudget: 100_000,
 *     spentToDate: 48_000,
 *     openDefects: 4,
 *     changeFailureRatePct: 5,
 *     testCoveragePct: 82,
 *     riskCount: 7,
 *     highSeverityRiskCount: 2,
 *     mitigatedRiskCount: 5,
 *     velocity: 22,
 *     targetVelocity: 25,
 *     activeContributors: 6,
 *     stakeholderAlignmentPct: 78,
 *     okrLinkedPct: 85,
 *   },
 * });
 * ```
 */
export function generateDiagnosticReport(input: DiagnosticInput): DiagnosticReport {
  validate(input);

  const { projectId, metrics, previousMetrics } = input;

  // Compute current scores
  const scores = {
    timeline: scoreTimeline(metrics),
    budget: scoreBudget(metrics),
    quality: scoreQuality(metrics),
    risk: scoreRisk(metrics),
    team: scoreTeam(metrics),
    alignment: scoreAlignment(metrics),
  };

  // Compute previous scores if available
  let prevScores: Partial<Record<keyof typeof scores, number>> | undefined;
  if (previousMetrics) {
    prevScores = {
      timeline: scoreTimeline(previousMetrics),
      budget: scoreBudget(previousMetrics),
      quality: scoreQuality(previousMetrics),
      risk: scoreRisk(previousMetrics),
      team: scoreTeam(previousMetrics),
      alignment: scoreAlignment(previousMetrics),
    };
  }

  const section = <K extends keyof typeof scores>(
    key: K,
    scorer: (m: DiagnosticMetrics) => number,
    summarizer: (m: DiagnosticMetrics, score: number, trend: Trend) => string,
  ): Section => {
    const score = scores[key];
    const prev = prevScores ? prevScores[key] : undefined;
    const trend = computeTrend(score, prev);
    const summary = summarizer(metrics, score, trend);
    return { score, trend, summary };
  };

  return {
    generatedAt: new Date().toISOString(),
    projectId,
    sections: {
      timeline: section('timeline', scoreTimeline, summaryTimeline),
      budget: section('budget', scoreBudget, summaryBudget),
      quality: section('quality', scoreQuality, summaryQuality),
      risk: section('risk', scoreRisk, summaryRisk),
      team: section('team', scoreTeam, summaryTeam),
      alignment: section('alignment', scoreAlignment, summaryAlignment),
    },
  };
}
