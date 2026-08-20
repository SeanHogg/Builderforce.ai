/**
 * The DEEP PASS — the half of a system audit that reads the code, and the hook
 * that puts what it found back into the report.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * `AuditRunner.runAudit` always produced the authoritative report from the
 * deterministic `scan()` and filed a best-effort remediation ticket for an agent
 * to do the real work. The Architecture diagnostic re-scores itself on
 * completion — `AnalysisRunnerDO.recordArchitectureDiagnostic` reads the
 * `principles` artifact and calls `recordExternalRun` with the derived result —
 * and the SOC 2 / Quality / PM Vision / Privacy audits had NO equivalent. The
 * agent ran, wrote a PR, and the diagnostic still showed the path-signal
 * first-pass forever. Whatever the deep pass actually found never reached the
 * report, the project rating or the tenant rollup.
 *
 * ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
 * Two halves, exactly as the Architecture path has them:
 *
 *   • a STRUCTURED artifact the workflow emits — here, findings submitted
 *     through `audits.report_findings`, rather than a free-text summary a
 *     completion hook would have to parse;
 *   • a completion hook — {@link applyAuditFindings} — that merges them into the
 *     deterministic result and records the enriched run.
 *
 * ── WHY THE DEEP PASS CAN ONLY LOWER A SCORE ────────────────────────────────
 * The first-pass score is evidence of what EXISTS: a CI workflow, a test suite, a
 * privacy route. An agent reading the code can prove those things are broken; it
 * cannot prove there is nothing else wrong. So findings subtract and nothing
 * adds. The alternative — letting a clean deep pass raise the score — means an
 * agent that failed to look hard enough reports the project as healthier than
 * the file tree does, which is the one direction an audit must never move by
 * accident.
 *
 * A clean pass is still recorded, and it is not a no-op: the summary says the
 * deep pass ran and found nothing, which is a materially different report from
 * "nobody has looked yet" even though the number is identical.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { toolRuns } from '../../infrastructure/database/schema';
import { clampAuditLevel, levelName } from './auditScanners';
import { getSystemAudit } from './systemAudits';
import type { ToolService, SavedToolRun } from './ToolService';
import type { ToolResult, ToolMetric, ToolRecommendation } from './toolTypes';

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** One thing the deep pass found in the code. */
export interface AuditFinding {
  title: string;
  detail?: string | null;
  severity?: FindingSeverity;
  /** Where it is — a path, a route, a table. Rendered on the metric row. */
  location?: string | null;
  /** What to do. Becomes a ranked recommendation on the report. */
  recommendation?: string | null;
}

/**
 * How far each severity pulls the 1–5 score down.
 *
 * Calibrated so a single critical finding moves a project a full maturity level
 * and `info` moves nothing at all: an observation the agent wanted on the record
 * must be able to appear on the report without changing the number, or the agent
 * learns to withhold context to protect a score.
 */
const SEVERITY_PENALTY: Record<FindingSeverity, number> = {
  critical: 1.0,
  high: 0.6,
  medium: 0.3,
  low: 0.15,
  info: 0,
};

/** Ranked worst-first, so the report's top recommendation is the top risk. */
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

const RECOMMENDATION_PRIORITY: Record<FindingSeverity, ToolRecommendation['priority']> = {
  critical: 'high', high: 'high', medium: 'medium', low: 'low', info: 'low',
};

function normalizeSeverity(value: unknown): FindingSeverity {
  const lower = String(value ?? '').toLowerCase();
  return (FINDING_SEVERITIES as readonly string[]).includes(lower) ? (lower as FindingSeverity) : 'medium';
}

/**
 * Merge deep-pass findings into the deterministic report. PURE — every IO-free
 * decision about what the enriched report says lives here and is unit-tested.
 */
export function mergeAuditFindings(
  base: ToolResult,
  rawFindings: readonly AuditFinding[],
  options: { auditName: string },
): ToolResult {
  const findings = [...rawFindings]
    .map((f) => ({ ...f, severity: normalizeSeverity(f.severity) }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);

  // `base.score` may be null — a first pass with no readable repo scores nothing,
  // and subtracting from nothing must stay nothing rather than inventing a 5.
  const baseScore = typeof base.score === 'number' ? base.score : null;
  const score = baseScore == null ? null : Math.max(1, Math.round((baseScore - penalty) * 10) / 10);

  const countLine = FINDING_SEVERITIES
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(', ');

  const verdict = findings.length
    ? `${options.auditName} deep pass: ${findings.length} finding${findings.length === 1 ? '' : 's'}${countLine ? ` (${countLine})` : ''}.`
    : `${options.auditName} deep pass found no additional issues in the code.`;

  const findingMetrics: ToolMetric[] = findings.map((f) => ({
    label: f.title.slice(0, 160),
    value: f.severity,
    hint: [f.location, f.detail].filter(Boolean).join(' — ').slice(0, 240) || undefined,
    // A finding's own tier, so the meter beside it reads as the risk it is
    // rather than inheriting the project's overall maturity.
    tier: clampAuditLevel(5 - SEVERITY_PENALTY[f.severity] * 4),
  }));

  const findingRecommendations: ToolRecommendation[] = findings
    .filter((f) => f.recommendation)
    .map((f) => ({
      title: f.title.slice(0, 200),
      detail: String(f.recommendation).slice(0, 1000),
      priority: RECOMMENDATION_PRIORITY[f.severity],
    }));

  // Deep-pass recommendations lead: they are evidence from the code, and the
  // first-pass ones are inferences from a file tree. A reader works top-down.
  const deduped = new Map<string, ToolRecommendation>();
  for (const rec of [...findingRecommendations, ...base.recommendations]) {
    const key = rec.title.trim().toLowerCase();
    if (!deduped.has(key)) deduped.set(key, rec);
  }

  return {
    ...base,
    headline: score == null ? base.headline : `${levelName(score)} — ${score.toFixed(1)} / 5`,
    summary: [verdict, base.summary].filter(Boolean).join(' '),
    score,
    scoreLabel: score == null ? base.scoreLabel : levelName(score),
    metrics: [...findingMetrics, ...base.metrics],
    recommendations: [...deduped.values()],
  };
}

/**
 * The completion hook.
 *
 * Reads the audit's own most recent run for this project — the deterministic
 * first pass `runAudit` just wrote — merges the findings into it, and records the
 * enriched result. That in turn refreshes the project rating and the tenant
 * rollup, because `recordExternalRun` is the same door every diagnostic goes
 * through.
 *
 * Returns null when the audit id is unknown or no first pass exists: a deep pass
 * with nothing to enrich is a workflow that ran against the wrong project, and
 * fabricating a base result would publish a score derived from no evidence at all.
 */
export async function applyAuditFindings(
  db: Db,
  toolService: ToolService,
  env: Env,
  args: {
    tenantId: number;
    projectId: number;
    auditId: string;
    findings: readonly AuditFinding[];
    createdBy?: string | null;
  },
): Promise<SavedToolRun | null> {
  const audit = getSystemAudit(args.auditId);
  if (!audit) return null;

  const [previous] = await db
    .select({ result: toolRuns.result })
    .from(toolRuns)
    .where(and(
      eq(toolRuns.tenantId, args.tenantId),
      eq(toolRuns.projectId, args.projectId),
      eq(toolRuns.toolId, audit.id),
    ))
    .orderBy(desc(toolRuns.createdAt))
    .limit(1);

  const base = previous?.result as ToolResult | undefined;
  if (!base || typeof base.headline !== 'string') return null;

  return toolService.recordExternalRun(env, {
    tenantId: args.tenantId,
    projectId: args.projectId,
    toolId: audit.id,
    result: mergeAuditFindings(
      { ...base, metrics: base.metrics ?? [], recommendations: base.recommendations ?? [] },
      args.findings,
      { auditName: audit.name },
    ),
    createdBy: args.createdBy ?? null,
  });
}
