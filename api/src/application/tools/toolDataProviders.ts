/**
 * Data-driven ("from your data") providers for tools that have an objective,
 * telemetry-derived mode in addition to the self-assessment. A tool is offered
 * a data-driven mode purely because an entry exists here for its id — the tool
 * DEFINITION stays pure (no DB). ToolService looks this registry up.
 *
 * Currently only the Agentic Maturity Diagnostic has one (derived from DORA,
 * cycle time, rework, and run outcomes). Adding a data mode to another tool is a
 * new entry here, not a change to the generic engine.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { memberMetricsPeriod, deploymentEvents, runModelOutcomes, ticketAudits, tasks } from '../../infrastructure/database/schema';
import { computeProjectDeliveryMetrics } from '../metrics/workforceMetrics';
import { getTool } from './toolDefinitions';
import type { QuestionnaireTool, ToolResult, ToolMetric, ToolRecommendation } from './toolTypes';

/** A data provider derives a tool's result from real telemetry. When `projectId`
 *  is supplied the result is scoped to that project (sections that cannot be
 *  attributed to a project fall back to "insufficient data"). */
export type ToolDataProvider = (db: Db, tenantId: number, days: number, projectId?: number | null) => Promise<ToolResult>;

const LEVEL_NAMES = ['Initial', 'Managed', 'Defined', 'Quantitatively Managed', 'Optimizing'];

// ── Pure scoring: aggregated telemetry → per-practice levels → ToolResult ──────

export interface MaturityDataInputs {
  delivery: { avgCycleTimeHours: number | null; reworkRate: number | null; completed: number } | null;
  devops: { deploysPerWeek: number; changeFailureRate: number; mttrHours: number | null; total: number } | null;
  quality: { ciGreenRate: number | null; avgScore: number | null; runs: number } | null;
  projectManagement: { completed: number; avgHygiene: number | null } | null;
  agenticOps: { runs: number; avgScore: number | null; mergeRate: number | null } | null;
}

function deliveryLevel(d: MaturityDataInputs['delivery']): number | null {
  if (!d || d.completed <= 0 || d.avgCycleTimeHours == null) return null;
  const ct = d.avgCycleTimeHours, rw = d.reworkRate ?? 0;
  if (ct <= 24 && rw <= 0.05) return 5;
  if (ct <= 72 && rw <= 0.12) return 4;
  if (ct <= 168 && rw <= 0.25) return 3;
  return 2;
}
function devopsLevel(d: MaturityDataInputs['devops']): number | null {
  if (!d || d.total <= 0) return null;
  const fast = d.mttrHours == null || d.mttrHours <= 24;
  if (d.deploysPerWeek >= 7 && d.changeFailureRate <= 0.15 && fast) return 5;
  if (d.deploysPerWeek >= 1 && d.changeFailureRate <= 0.20 && (d.mttrHours == null || d.mttrHours <= 72)) return 4;
  if (d.deploysPerWeek >= 0.25 && d.changeFailureRate <= 0.30) return 3;
  return 2;
}
function qualityLevel(d: MaturityDataInputs['quality']): number | null {
  if (!d || d.runs <= 0 || d.ciGreenRate == null) return null;
  const ci = d.ciGreenRate, sc = d.avgScore ?? 0;
  if (ci >= 0.9 && sc >= 0.7) return 5;
  if (ci >= 0.75 && sc >= 0.55) return 4;
  if (ci >= 0.5) return 3;
  return 2;
}
function pmLevel(d: MaturityDataInputs['projectManagement']): number | null {
  if (!d || d.completed <= 0) return null;
  const hy = d.avgHygiene ?? 0;
  if (d.completed >= 30 && hy >= 0.8) return 5;
  if (d.completed >= 10 && hy >= 0.6) return 4;
  if (d.completed >= 3) return 3;
  return 2;
}
function agenticLevel(d: MaturityDataInputs['agenticOps']): number | null {
  if (!d || d.runs <= 0) return null;
  const sc = d.avgScore ?? 0, mr = d.mergeRate ?? 0;
  if (d.runs >= 50 && sc >= 0.7 && mr >= 0.5) return 5;
  if (d.runs >= 15 && sc >= 0.55) return 4;
  if (d.runs >= 5) return 3;
  return 2;
}

/** Pure: map aggregated telemetry to a ToolResult, reusing the agentic-maturity
 *  tool's section names + recommendations so self and data modes never drift. */
export function scoreAgenticMaturityData(inp: MaturityDataInputs): ToolResult {
  const tool = getTool('agentic-maturity') as QuestionnaireTool;
  const levelByKey: Record<string, number | null> = {
    delivery: deliveryLevel(inp.delivery),
    devops: devopsLevel(inp.devops),
    quality: qualityLevel(inp.quality),
    project_management: pmLevel(inp.projectManagement),
    agentic_ops: agenticLevel(inp.agenticOps),
    governance: null, // no objective signal yet — self-assessment only
  };

  const metrics: ToolMetric[] = [];
  const recommendations: ToolRecommendation[] = [];
  const levels: number[] = [];

  for (const section of tool.sections) {
    const lvl = levelByKey[section.key] ?? null;
    if (lvl == null) {
      metrics.push({ label: section.name, value: section.key === 'governance' ? 'Self-assessment only' : 'Insufficient data' });
      continue;
    }
    levels.push(lvl);
    metrics.push({ label: section.name, value: `Level ${lvl} — ${LEVEL_NAMES[lvl - 1]}`, tier: lvl });
    if (lvl < 5) {
      recommendations.push({ title: `${section.name} — to Level ${lvl + 1}`, detail: section.recommendations[lvl + 1] ?? 'Continue improving this practice.' });
    }
  }

  recommendations.sort((a, b) => a.title.localeCompare(b.title)); // stable; plan order below
  // Order the plan lowest-maturity-first like the self-assessment.
  const ordered = tool.sections
    .map((s) => ({ s, lvl: levelByKey[s.key] }))
    .filter((x): x is { s: typeof x.s; lvl: number } => typeof x.lvl === 'number' && x.lvl < 5)
    .sort((a, b) => a.lvl - b.lvl)
    .map((x) => ({ title: `${x.s.name} — to Level ${x.lvl + 1}`, detail: x.s.recommendations[x.lvl + 1] ?? 'Continue improving this practice.' }));

  const overall = levels.length ? Math.round((levels.reduce((s, v) => s + v, 0) / levels.length) * 10) / 10 : null;
  const overallName = overall != null ? LEVEL_NAMES[Math.max(1, Math.min(5, Math.round(overall))) - 1] : null;

  return {
    headline: overall != null ? `Level ${overall} — ${overallName}` : 'Not enough telemetry yet',
    summary: overall != null
      ? 'Scored objectively from your last delivery window — DORA, cycle time, rework, and agent outcomes.'
      : 'Run some work (deploys, tasks, agent runs) and check back, or use the self-assessment.',
    score: overall,
    scoreLabel: overallName,
    metrics,
    recommendations: ordered,
  };
}

// ── DB aggregation provider ───────────────────────────────────────────────────

function norm01(v: number | null | undefined): number | null {
  if (v == null) return null;
  return v > 1 ? Math.min(1, v / 100) : Math.max(0, v);
}

const agenticMaturityProvider: ToolDataProvider = async (db, tenantId, days, projectId) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const forProject = projectId != null;

  // member_metrics_period is a per-member tenant snapshot (no project grain), so
  // when scoped to a project compute delivery live from its tasks (reusing the
  // shared scorer); at tenant grain read the snapshot aggregate.
  const memberAggP = forProject
    ? computeProjectDeliveryMetrics(db, tenantId, projectId!, days).then((p) => [{
        completed: p.completed,
        redo: 0,
        reopen: 0,
        // reworkRate is already (redo+reopen)/completed; carry it through so the
        // back-computed reworkRate below reproduces it exactly.
        rework: p.reworkRate,
        avgCycle: p.avgCycleTimeHours,
        avgHygiene: p.boardHygieneScore,
      }])
    : db.select({
        completed: sql<number>`coalesce(sum(${memberMetricsPeriod.completedCount}), 0)::int`,
        redo: sql<number>`coalesce(sum(${memberMetricsPeriod.redoCount}), 0)::int`,
        reopen: sql<number>`coalesce(sum(${memberMetricsPeriod.reopenCount}), 0)::int`,
        rework: sql<number | null>`null::double precision`,
        avgCycle: sql<number | null>`avg(${memberMetricsPeriod.avgCycleTimeHours})`,
        avgHygiene: sql<number | null>`avg(${memberMetricsPeriod.boardHygieneScore})`,
      }).from(memberMetricsPeriod).where(and(eq(memberMetricsPeriod.tenantId, tenantId), gte(memberMetricsPeriod.periodEnd, since)));

  const [memberAgg, deployAgg, outcomeAgg] = await Promise.all([
    memberAggP,

    db.select({
      total: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${deploymentEvents.isFailure})::int`,
      avgMttrHours: sql<number | null>`avg(extract(epoch from (${deploymentEvents.restoredAt} - ${deploymentEvents.deployedAt})) / 3600.0) filter (where ${deploymentEvents.restoredAt} is not null)`,
    }).from(deploymentEvents).where(and(
      eq(deploymentEvents.tenantId, tenantId),
      gte(deploymentEvents.deployedAt, since),
      ...(forProject ? [eq(deploymentEvents.projectId, projectId!)] : []),
    )),

    db.select({
      runs: sql<number>`count(*)::int`,
      avgScore: sql<number | null>`avg(${runModelOutcomes.score})`,
      ciGreen: sql<number>`count(*) filter (where ${runModelOutcomes.ciGreen})::int`,
      merged: sql<number>`count(*) filter (where ${runModelOutcomes.merged})::int`,
    }).from(runModelOutcomes).where(and(
      eq(runModelOutcomes.tenantId, tenantId),
      gte(runModelOutcomes.createdAt, since),
      ...(forProject ? [eq(runModelOutcomes.projectId, projectId!)] : []),
    )),
  ]);

  const m = memberAgg[0]!, d = deployAgg[0]!, o = outcomeAgg[0]!;
  const weeks = Math.max(days / 7, 0.1);
  const completed = Number(m.completed) || 0;
  // Project path supplies reworkRate directly; tenant path back-computes it from
  // the snapshot's redo/reopen sums.
  const reworkRate = m.rework != null
    ? Number(m.rework)
    : completed > 0 ? (Number(m.redo) + Number(m.reopen)) / completed : null;
  const runs = Number(o.runs) || 0;
  const deployTotal = Number(d.total) || 0;

  return scoreAgenticMaturityData({
    delivery: completed > 0 ? { avgCycleTimeHours: m.avgCycle ?? null, reworkRate, completed } : null,
    projectManagement: completed > 0 ? { completed, avgHygiene: norm01(m.avgHygiene ?? null) } : null,
    devops: deployTotal > 0 ? { deploysPerWeek: deployTotal / weeks, changeFailureRate: Number(d.failures) / deployTotal, mttrHours: d.avgMttrHours ?? null, total: deployTotal } : null,
    quality: runs > 0 ? { ciGreenRate: Number(o.ciGreen) / runs, avgScore: o.avgScore ?? null, runs } : null,
    agenticOps: runs > 0 ? { runs, avgScore: o.avgScore ?? null, mergeRate: Number(o.merged) / runs } : null,
  });
};

/**
 * Ticket Role & Diagnostic Coverage — scored objectively from the per-ticket audit
 * ledger (ticket_audits). Backs the Manager AI agent's ticket-coverage diagnostic.
 */
const ticketRoleCoverageProvider: ToolDataProvider = async (db, tenantId, _days, projectId) => {
  const forProject = projectId != null;
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      flagged: sql<number>`count(*) filter (where ${ticketAudits.status} = 'flagged')::int`,
      withReqs: sql<number>`count(*) filter (where ${ticketAudits.requiredCount} > 0)::int`,
      avgCoverage: sql<number | null>`avg(${ticketAudits.coverage}) filter (where ${ticketAudits.requiredCount} > 0)`,
    })
    .from(ticketAudits)
    .innerJoin(tasks, eq(ticketAudits.taskId, tasks.id))
    .where(and(eq(ticketAudits.tenantId, tenantId), ...(forProject ? [eq(tasks.projectId, projectId!)] : [])));

  const withReqs = Number(agg?.withReqs) || 0;
  const flagged = Number(agg?.flagged) || 0;
  if (withReqs === 0) {
    return {
      headline: 'No audited tickets yet',
      summary: 'Move some tickets through a role-gated board (or apply a kanban template) and check back.',
      score: null, scoreLabel: null,
      metrics: [{ label: 'Audited tickets', value: '0' }],
      recommendations: [{ title: 'Apply a kanban template', detail: 'Give each lane a responsible role + required checks so tickets can be audited.' }],
    };
  }

  const passRate = (withReqs - flagged) / withReqs;
  const avgCoverage = agg?.avgCoverage != null ? Math.round(Number(agg.avgCoverage)) : null;
  const level = passRate >= 0.95 ? 5 : passRate >= 0.85 ? 4 : passRate >= 0.6 ? 3 : passRate >= 0.3 ? 2 : 1;

  return {
    headline: `Level ${level} — ${LEVEL_NAMES[level - 1]}`,
    summary: `${Math.round(passRate * 100)}% of tickets with required checks passed their audit${flagged ? ` — ${flagged} flagged for review.` : '.'}`,
    score: level,
    scoreLabel: LEVEL_NAMES[level - 1],
    metrics: [
      { label: 'Tickets audited', value: String(withReqs) },
      { label: 'Passing coverage', value: `${Math.round(passRate * 100)}%`, tier: level },
      { label: 'Flagged for review', value: String(flagged), tier: flagged === 0 ? 5 : Math.max(1, 5 - Math.min(4, flagged)) },
      ...(avgCoverage != null ? [{ label: 'Avg. required-check coverage', value: `${avgCoverage}%` }] : []),
    ],
    recommendations: flagged > 0
      ? [{ title: `Resolve ${flagged} flagged ${flagged === 1 ? 'ticket' : 'tickets'}`, detail: 'Open the Ticket Audit panel to see which required role or diagnostic each flagged ticket is missing, and route it back to the responsible role.' }]
      : [{ title: 'Coverage is healthy', detail: 'Keep required roles + diagnostics attached to your lanes as the board evolves.' }],
  };
};

export const TOOL_DATA_PROVIDERS: Record<string, ToolDataProvider> = {
  'agentic-maturity': agenticMaturityProvider,
  'ticket-role-coverage': ticketRoleCoverageProvider,
};

export function hasDataProvider(toolId: string): boolean {
  return toolId in TOOL_DATA_PROVIDERS;
}
