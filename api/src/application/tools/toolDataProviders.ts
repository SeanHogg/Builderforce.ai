/**
 * Data-driven ("from your data") providers for tools that have an objective,
 * telemetry-derived mode in addition to the self-assessment. A tool is offered
 * a data-driven mode purely because an entry exists here for its id — the tool
 * DEFINITION stays pure (no DB). ToolService looks this registry up.
 *
 * Four tools have one:
 *   - `agentic-maturity`     — DORA, cycle time, rework, run outcomes
 *   - `ticket-role-coverage` — the per-ticket audit ledger
 *   - `dora-quickcheck`      — `deployment_events` + task lead time
 *   - `ai-cost-estimator`    — attributed `llm_usage_log` spend
 *
 * Adding a data mode to another tool is a new entry here, not a change to the
 * generic engine.
 *
 * THE RULE THE LAST TWO EXIST TO KEEP. Both of those tools' `about` copy has
 * always told the reader "sign in to score this from your real data", and for a
 * long time neither could — so the only DORA or cost figure a canvas board could
 * hold was a number the operator typed in, sitting beside their real work and
 * looking equally authoritative. Neither provider defines its own metric: DORA
 * reuses {@link computeDora} (the same collector behind `/api/pmo/rollup`) and
 * cost reads the authoritative `cost_usd_millicents` stamped at write time. A
 * data mode is a second WAY IN to one number, never a second number.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { memberMetricsPeriod, deploymentEvents, llmUsageLog, projects, runModelOutcomes, ticketAudits, tasks } from '../../infrastructure/database/schema';
import { computeDora, computeProjectDeliveryMetrics } from '../metrics/workforceMetrics';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';
import { notSystemTask } from '../task/taskScope';
import { getTool, money, tierName } from './toolDefinitions';
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

// ── DORA Quick-Check, scored from real deployments ────────────────────────────

/**
 * The four keys from `deployment_events` + task lead time, rather than four
 * numbers a person typed in.
 *
 * The tool's own `about` copy has always promised this ("sign in to score this
 * automatically from your real deployment data") and there was no provider behind
 * it, so the only DORA a board could show was the operator's guess — sitting
 * beside their real work and looking equally authoritative. The collector already
 * existed: {@link computeDora} is the same one `/api/pmo/rollup` and the workforce
 * metrics use, so this adds a mode, not a second definition of the four keys.
 *
 * Tiering mirrors the calculator's thresholds exactly (7/1/0.25 deploys per week,
 * 24/168/730h lead time, 5/15/30% change failure, 1/24/168h restore) so the two
 * modes cannot drift into disagreeing about what "Elite" means.
 */
const doraTier = {
  frequency: (perWeek: number) => (perWeek >= 7 ? 5 : perWeek >= 1 ? 4 : perWeek >= 0.25 ? 3 : 2),
  leadTime: (hours: number) => (hours <= 24 ? 5 : hours <= 168 ? 4 : hours <= 730 ? 3 : 2),
  changeFailure: (pct: number) => (pct <= 5 ? 5 : pct <= 15 ? 4 : pct <= 30 ? 3 : 2),
  restore: (hours: number) => (hours <= 1 ? 5 : hours <= 24 ? 4 : hours <= 168 ? 3 : 2),
};

/** The calculator's remediation copy, keyed so both modes read one source. */
const DORA_RECOMMENDATIONS: Record<string, ToolRecommendation> = {
  frequency: { title: 'Deploy more often', detail: 'Shrink batch sizes and automate the release pipeline so deploys are routine, not events. Aim for at least weekly, then daily.' },
  leadTime: { title: 'Cut lead time', detail: 'Reduce hand-offs and manual gates between commit and production. Trunk-based development and CI on every change are the biggest levers.' },
  changeFailure: { title: 'Lower change-failure rate', detail: 'Add automated tests and progressive delivery (canary / feature flags) so risky changes are caught or contained before full rollout.' },
  restore: { title: 'Restore faster', detail: 'Invest in alerting, one-click rollback, and runbooks so a failed change is reverted in minutes, not hours.' },
};

const doraQuickCheckProvider: ToolDataProvider = async (db, tenantId, days, projectId) => {
  const dora = await computeDora(db, tenantId, days, projectId ?? undefined);
  const perWeek = dora.deploymentFrequencyPerDay * 7;

  // Each key is scored only when it HAS a number. A tenant that deploys through
  // Builderforce but has not recorded a restore has no MTTR, and inventing one
  // (0h reads as Elite) would be the same lie the hand-entered default was.
  const scored: Array<{ key: keyof typeof DORA_RECOMMENDATIONS; label: string; value: string; tier: number }> = [];
  const unscored: ToolMetric[] = [];

  if (dora.totalDeployments > 0) {
    scored.push({ key: 'frequency', label: 'Deployment frequency', value: `${perWeek.toFixed(1)}/week`, tier: doraTier.frequency(perWeek) });
  } else {
    unscored.push({ label: 'Deployment frequency', value: 'No deployments recorded' });
  }
  if (dora.leadTimeHours != null) {
    scored.push({ key: 'leadTime', label: 'Lead time for changes', value: `${Math.round(dora.leadTimeHours)}h`, tier: doraTier.leadTime(dora.leadTimeHours) });
  } else {
    unscored.push({ label: 'Lead time for changes', value: 'No completed tickets in window' });
  }
  if (dora.changeFailureRatePct != null) {
    scored.push({ key: 'changeFailure', label: 'Change-failure rate', value: `${dora.changeFailureRatePct.toFixed(1)}%`, tier: doraTier.changeFailure(dora.changeFailureRatePct) });
  } else {
    unscored.push({ label: 'Change-failure rate', value: 'No deployments recorded' });
  }
  if (dora.mttrHours != null) {
    scored.push({ key: 'restore', label: 'Time to restore', value: `${dora.mttrHours.toFixed(1)}h`, tier: doraTier.restore(dora.mttrHours) });
  } else {
    unscored.push({ label: 'Time to restore', value: 'No restored failures in window' });
  }

  if (scored.length === 0) {
    return {
      headline: 'Not enough delivery telemetry yet',
      summary: `No deployments or completed tickets in the last ${days} days. Record deployments (or complete some tickets) and check back, or use the estimate mode.`,
      score: null, scoreLabel: null,
      metrics: [{ label: 'Window', value: `${days} days` }, ...unscored],
      recommendations: [{ title: 'Start recording deployments', detail: 'Deployment events are what turn the four keys from a self-assessment into a measurement. Wire your release pipeline to the deployments API, or let the cloud agent record them as it ships.' }],
    };
  }

  const overall = Math.round(scored.reduce((sum, metric) => sum + metric.tier, 0) / scored.length);
  const recommendations = scored
    .filter((metric) => metric.tier < 4)
    .sort((a, b) => a.tier - b.tier)
    .map((metric) => DORA_RECOMMENDATIONS[metric.key]!);
  if (recommendations.length === 0) {
    recommendations.push({ title: 'Sustain elite performance', detail: 'Keep the four keys under continuous review and protect them as you scale — elite teams optimize, they do not coast.' });
  }

  return {
    headline: `${tierName(overall)} performer`,
    summary: `Scored from your real delivery data over the last ${days} days — ${dora.totalDeployments} deployment${dora.totalDeployments === 1 ? '' : 's'}${scored.length < 4 ? `, ${4 - scored.length} of the four keys not yet measurable` : ''}.`,
    score: overall,
    scoreLabel: tierName(overall),
    metrics: [
      ...scored.map((metric) => ({ label: metric.label, value: metric.value, hint: tierName(metric.tier), tier: metric.tier })),
      ...unscored,
    ],
    recommendations,
  };
};

// ── AI Cost Estimator, replaced by real attributed spend ──────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Real attributed spend from `llm_usage_log` — the estimator's own promise
 * ("sign in to replace the estimate with your real, attributed spend: cost per
 * task, per project, per merged PR") kept.
 *
 * Cost is read from `cost_usd_millicents`, which is stamped authoritatively at
 * write time from the resolved model's price including cache tiers — NOT
 * re-priced from tokens here, which would silently disagree with the invoice.
 *
 * BYO rows are surfaced separately rather than folded in. Their cost is forced to
 * 0 because the platform paid nothing for those tokens, so counting them as spend
 * understates cost-per-task and counting them as free understates volume; the
 * honest presentation is both numbers, which is also what [[byo-usage-attribution]]
 * settled for the usage dashboard.
 *
 * One grouped query, no fan-out: this is a monthly-ish read on a small result set.
 */
const aiCostEstimatorProvider: ToolDataProvider = async (db, tenantId, days, projectId) => {
  const since = new Date(Date.now() - days * DAY_MS);
  const forProject = projectId != null;

  const [usage] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      millicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)`,
      tokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)`,
      cacheReadTokens: sql<string>`coalesce(sum(${llmUsageLog.cacheReadTokens}), 0)`,
      promptTokens: sql<string>`coalesce(sum(${llmUsageLog.promptTokens}), 0)`,
      byoCalls: sql<number>`count(*) filter (where ${llmUsageLog.byo})::int`,
      attributedTasks: sql<number>`count(distinct ${llmUsageLog.taskId})::int`,
    })
    .from(llmUsageLog)
    .where(and(
      eq(llmUsageLog.tenantId, tenantId),
      gte(llmUsageLog.createdAt, since),
      ...(forProject ? [eq(llmUsageLog.projectId, projectId!)] : []),
    ));

  const calls = Number(usage?.calls) || 0;
  if (calls === 0) {
    return {
      headline: 'No attributed spend yet',
      summary: `No agent LLM calls recorded in the last ${days} days${forProject ? ' for this project' : ''}. Run some agent work and check back, or use the estimate mode.`,
      score: null, scoreLabel: null,
      metrics: [{ label: 'Window', value: `${days} days` }, { label: 'Agent LLM calls', value: '0' }],
      recommendations: [{ title: 'Attribute and budget', detail: 'Every agent run stamps its tokens with a task and project, so cost rolls up ticket → project → account the moment work starts flowing. Set a budget with overspend alerts once it does.' }],
    };
  }

  const costUsd = Number(usage!.millicents) / MILLICENTS_PER_USD;
  const tokens = Number(usage!.tokens) || 0;
  const promptTokens = Number(usage!.promptTokens) || 0;
  const cacheReadTokens = Number(usage!.cacheReadTokens) || 0;
  const byoCalls = Number(usage!.byoCalls) || 0;
  const attributedTasks = Number(usage!.attributedTasks) || 0;
  // Cache hit rate measured the way the estimator asks for it: the share of
  // PROMPT tokens served from cache (cache reads are a subset of prompt tokens).
  const cacheHitPct = promptTokens > 0 ? (cacheReadTokens / promptTokens) * 100 : 0;
  const perMonth = costUsd * (30 / Math.max(days, 1));

  // Delivered tickets in the same window — the "cost per outcome" the estimator's
  // last recommendation asks for, from the same task table DORA's lead time uses.
  const [delivered] = await db
    .select({ completed: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      gte(tasks.completedAt, since),
      ...(forProject ? [eq(tasks.projectId, projectId!)] : []),
      notSystemTask,
    ));
  const completed = Number(delivered?.completed) || 0;

  const recommendations: ToolRecommendation[] = [];
  if (cacheHitPct < 40) {
    recommendations.push({ title: 'Raise your cache hit rate', detail: `Only ${cacheHitPct.toFixed(0)}% of your prompt tokens are being served from cache. Prompt caching reuses the stable prefix of a conversation at roughly a tenth of the input rate — pushing this toward 40–60% cuts spend with no quality loss.` });
  }
  if (attributedTasks === 0) {
    recommendations.push({ title: 'Attribute spend to tickets', detail: 'None of this spend carries a task id, so it can be totalled but not explained. Cost is stamped from the run\'s task — dispatching work from a ticket rather than an ad-hoc prompt is what makes cost-per-outcome answerable.' });
  }
  if (completed > 0) {
    recommendations.push({ title: 'Track cost per outcome, not per token', detail: `You spent ${money(costUsd)} to deliver ${completed} ticket${completed === 1 ? '' : 's'}. Watch this ratio rather than the token count — the cheapest model that fails twice is more expensive than the right one.` });
  }
  if (byoCalls > 0) {
    recommendations.push({ title: 'BYO traffic is excluded from cost', detail: `${byoCalls} of ${calls} calls ran on your own provider credential, so they cost the platform nothing and are recorded at zero. Rank those by tokens rather than by spend when comparing model usage.` });
  }
  if (recommendations.length === 0) {
    recommendations.push({ title: 'Spend is measured and attributed', detail: 'Set a budget with overspend alerts so cost stays managed rather than discovered on the invoice.' });
  }

  return {
    headline: `${money(perMonth)} / month`,
    summary: `Real attributed agent spend over the last ${days} days, projected to a month. Cost is stamped per call at the resolved model's price, including cache tiers.`,
    score: null,
    scoreLabel: null,
    metrics: [
      { label: 'Spend in window', value: money(costUsd) },
      { label: 'Projected monthly cost', value: money(perMonth) },
      { label: 'Tokens', value: `${(tokens / 1_000_000).toFixed(1)}M` },
      { label: 'Prompt tokens served from cache', value: `${cacheHitPct.toFixed(0)}%` },
      { label: 'Agent LLM calls', value: calls.toLocaleString('en-US') },
      { label: 'Tickets carrying spend', value: attributedTasks.toLocaleString('en-US') },
      ...(completed > 0 ? [{ label: 'Cost per delivered ticket', value: `$${(costUsd / completed).toFixed(2)}` }] : []),
      ...(byoCalls > 0 ? [{ label: 'Calls on your own credential', value: `${byoCalls.toLocaleString('en-US')} (billed at $0)` }] : []),
    ],
    recommendations,
  };
};

export const TOOL_DATA_PROVIDERS: Record<string, ToolDataProvider> = {
  'agentic-maturity': agenticMaturityProvider,
  'ticket-role-coverage': ticketRoleCoverageProvider,
  'dora-quickcheck': doraQuickCheckProvider,
  'ai-cost-estimator': aiCostEstimatorProvider,
};

export function hasDataProvider(toolId: string): boolean {
  return toolId in TOOL_DATA_PROVIDERS;
}
