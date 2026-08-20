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
import { getTool, money } from './toolDefinitions';
import { pluralSlug, type ToolCopy } from './analyzerCopy';
import { DEFAULT_TOOL_LOCALE, resultCopy, type ResultCopy } from './resultCopy';
import type { QuestionnaireTool, Tool, ToolResult, ToolMetric, ToolRecommendation } from './toolTypes';

/**
 * Everything a data result needs that is NOT a number.
 *
 * `chrome` is the engine's shared band naming (`resultCopy.ts`), `copy` is this
 * tool's own declared result prose, and `tool` is the LOCALIZED definition — a
 * questionnaire's telemetry result is built from its own section names, so
 * handing in the translated tool translates the result with no second catalog.
 */
export interface DataScoreContext {
  chrome: ResultCopy;
  copy: ToolCopy;
  tool: Tool;
}

/**
 * A data provider, split in two halves — and the split is the whole point.
 *
 * `collect` does the IO: it reads a telemetry WINDOW that will have passed by the
 * time anyone re-reads the run. `score` is pure and turns those figures into
 * prose in ONE language.
 *
 * Before the split, a saved `kind='data'` run stored only the rendered English
 * and there was nothing to re-render from, so a snapshot taken by a German
 * manager read as German to an English teammate forever. Now the figures are
 * persisted as data (see `storedToolResult.ts`) and the chrome is composed at
 * READ time in the reader's language — which is also why the collected figures,
 * not the rendered result, are what the read-through cache holds: one telemetry
 * aggregation now serves all five locales instead of five.
 *
 * When `projectId` is supplied the collection is scoped to that project (sections
 * that cannot be attributed to a project fall back to "insufficient data").
 */
export interface ToolDataProvider {
  collect: (db: Db, tenantId: number, days: number, projectId?: number | null) => Promise<unknown>;
  score: (figures: unknown, ctx: DataScoreContext) => ToolResult;
}

/**
 * Bind a TYPED provider into the type-erased registry.
 *
 * The registry has to be erased — `ToolService` looks a provider up by id and
 * cannot know which figures shape it will get back — but each provider should
 * still be written against its own type. `score`'s parameter is contravariant, so
 * a `ToolDataProvider<DoraFigures>` is genuinely not a `ToolDataProvider<unknown>`
 * and TypeScript is right to refuse it.
 *
 * The one narrowing lives here rather than at four call sites. It is sound
 * because `collect` and `score` are two halves of ONE provider: the payload
 * `score` receives is always the payload this provider's own `collect` produced,
 * or a payload read back out of a run this provider wrote. The read side already
 * defends the remaining case — a stored payload whose shape has since moved on
 * degrades to the run's stored rendering rather than scoring garbage.
 */
function dataProvider<F>(p: {
  collect: (db: Db, tenantId: number, days: number, projectId?: number | null) => Promise<F>;
  score: (figures: F, ctx: DataScoreContext) => ToolResult;
}): ToolDataProvider {
  return { collect: p.collect, score: (figures, ctx) => p.score(figures as F, ctx) };
}

/** A counted phrase: `<slug>.one` at exactly one, `<slug>.other` otherwise. */
const counted = (c: ToolCopy, slug: string, n: number, vars?: Record<string, string | number>): string =>
  c(pluralSlug(slug, n), { n, ...vars });

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

/**
 * Pure: map aggregated telemetry to a ToolResult, reusing the agentic-maturity
 * tool's section names + recommendations so self and data modes never drift.
 *
 * `tool` is injected (defaulting to the registry's own) precisely so the caller
 * can hand in the LOCALIZED tool — the section names and advancement actions in
 * this result come from the tool itself, so translating the tool translates the
 * telemetry result, with no second catalog. `copy` covers the chrome around them.
 */
export function scoreAgenticMaturityData(
  inp: MaturityDataInputs,
  copy: ResultCopy = resultCopy(DEFAULT_TOOL_LOCALE),
  tool: QuestionnaireTool = getTool('agentic-maturity') as QuestionnaireTool,
): ToolResult {
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
      metrics.push({ key: section.key, label: section.name, value: section.key === 'governance' ? copy.selfAssessmentOnly : copy.insufficientData });
      continue;
    }
    levels.push(lvl);
    metrics.push({ key: section.key, label: section.name, value: copy.levelValue(lvl, copy.levelNames[lvl - 1]!), tier: lvl });
    if (lvl < 5) {
      recommendations.push({ title: copy.planTitle(section.name, lvl + 1), detail: section.recommendations[lvl + 1] ?? copy.keepImproving });
    }
  }

  recommendations.sort((a, b) => a.title.localeCompare(b.title)); // stable; plan order below
  // Order the plan lowest-maturity-first like the self-assessment.
  const ordered = tool.sections
    .map((s) => ({ s, lvl: levelByKey[s.key] }))
    .filter((x): x is { s: typeof x.s; lvl: number } => typeof x.lvl === 'number' && x.lvl < 5)
    .sort((a, b) => a.lvl - b.lvl)
    .map((x) => ({ title: copy.planTitle(x.s.name, x.lvl + 1), detail: x.s.recommendations[x.lvl + 1] ?? copy.keepImproving }));

  const overall = levels.length ? Math.round((levels.reduce((s, v) => s + v, 0) / levels.length) * 10) / 10 : null;
  const overallName = overall != null ? copy.levelNames[Math.max(1, Math.min(5, Math.round(overall))) - 1]! : null;

  return {
    headline: overall != null ? copy.levelValue(overall, overallName!) : copy.notEnoughTelemetry,
    summary: overall != null ? copy.scoredFromTelemetry : copy.telemetryPrompt,
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

const collectAgenticMaturity = async (db: Db, tenantId: number, days: number, projectId?: number | null): Promise<MaturityDataInputs> => {
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

  return {
    delivery: completed > 0 ? { avgCycleTimeHours: m.avgCycle ?? null, reworkRate, completed } : null,
    projectManagement: completed > 0 ? { completed, avgHygiene: norm01(m.avgHygiene ?? null) } : null,
    devops: deployTotal > 0 ? { deploysPerWeek: deployTotal / weeks, changeFailureRate: Number(d.failures) / deployTotal, mttrHours: d.avgMttrHours ?? null, total: deployTotal } : null,
    quality: runs > 0 ? { ciGreenRate: Number(o.ciGreen) / runs, avgScore: o.avgScore ?? null, runs } : null,
    agenticOps: runs > 0 ? { runs, avgScore: o.avgScore ?? null, mergeRate: Number(o.merged) / runs } : null,
  };
};

const agenticMaturityProvider = dataProvider<MaturityDataInputs>({
  collect: collectAgenticMaturity,
  // Every string in this result already came from the tool or the shared chrome,
  // so it needed no copy map of its own — translating the questionnaire had
  // always translated its telemetry twin too.
  score: (figures, ctx) => scoreAgenticMaturityData(figures, ctx.chrome, ctx.tool as QuestionnaireTool),
});

/**
 * Ticket Role & Diagnostic Coverage — scored objectively from the per-ticket audit
 * ledger (ticket_audits). Backs the Manager AI agent's ticket-coverage diagnostic.
 */
interface TicketCoverageFigures {
  withReqs: number;
  flagged: number;
  avgCoverage: number | null;
}

const collectTicketRoleCoverage = async (db: Db, tenantId: number, _days: number, projectId?: number | null): Promise<TicketCoverageFigures> => {
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

  return {
    withReqs: Number(agg?.withReqs) || 0,
    flagged: Number(agg?.flagged) || 0,
    avgCoverage: agg?.avgCoverage != null ? Math.round(Number(agg.avgCoverage)) : null,
  };
};

/** Pure: the audit ledger's figures → a scorecard in ONE language. The band
 *  NAMES come from the shared chrome, never from a private list here, so this
 *  scorecard cannot disagree with every other scorer about what "Level 3" is. */
const scoreTicketRoleCoverage = (f: TicketCoverageFigures, { chrome, copy: c }: DataScoreContext): ToolResult => {
  const { withReqs, flagged, avgCoverage } = f;
  if (withReqs === 0) {
    return {
      headline: c('empty.headline'),
      summary: c('empty.summary'),
      score: null, scoreLabel: null,
      metrics: [{ label: c('empty.metric'), value: (0).toLocaleString(c.locale) }],
      recommendations: [{ title: c('empty.title'), detail: c('empty.detail') }],
    };
  }

  const passRate = (withReqs - flagged) / withReqs;
  const pct = Math.round(passRate * 100);
  const level = passRate >= 0.95 ? 5 : passRate >= 0.85 ? 4 : passRate >= 0.6 ? 3 : passRate >= 0.3 ? 2 : 1;
  const percent = (n: number) => c('value.percent', { n: n.toLocaleString(c.locale) });

  return {
    headline: chrome.levelValue(level, chrome.levelNames[level - 1]!),
    // Two whole sentences, chosen by the count — never one sentence with a
    // clause concatenated onto it, which is untranslatable into a language whose
    // verb comes last.
    summary: flagged ? counted(c, 'summary.flagged', flagged, { pct }) : c('summary.clean', { pct }),
    score: level,
    scoreLabel: chrome.levelNames[level - 1]!,
    metrics: [
      { label: c('metric.audited'), value: withReqs.toLocaleString(c.locale) },
      { label: c('metric.passing'), value: percent(pct), tier: level },
      { label: c('metric.flagged'), value: flagged.toLocaleString(c.locale), tier: flagged === 0 ? 5 : Math.max(1, 5 - Math.min(4, flagged)) },
      ...(avgCoverage != null ? [{ label: c('metric.coverage'), value: percent(avgCoverage) }] : []),
    ],
    recommendations: flagged > 0
      ? [{ title: counted(c, 'rec.flagged.title', flagged), detail: c('rec.flagged.detail') }]
      : [{ title: c('rec.healthy.title'), detail: c('rec.healthy.detail') }],
  };
};

const ticketRoleCoverageProvider = dataProvider<TicketCoverageFigures>({
  collect: collectTicketRoleCoverage,
  score: scoreTicketRoleCoverage,
});

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

/** The four keys this provider scores. Named here so the FIGURES a saved run
 *  carries have a declared shape, and so the remediation lookup is exhaustive. */
type DoraKey = 'frequency' | 'leadTime' | 'changeFailure' | 'restore';

interface DoraFigures {
  days: number;
  totalDeployments: number;
  deploymentFrequencyPerDay: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
}

const collectDoraQuickCheck = async (db: Db, tenantId: number, days: number, projectId?: number | null): Promise<DoraFigures> => {
  const dora = await computeDora(db, tenantId, days, projectId ?? undefined);
  return {
    days,
    totalDeployments: dora.totalDeployments,
    deploymentFrequencyPerDay: dora.deploymentFrequencyPerDay,
    leadTimeHours: dora.leadTimeHours,
    changeFailureRatePct: dora.changeFailureRatePct,
    mttrHours: dora.mttrHours,
  };
};

/**
 * Pure: the four keys → a tier and a plan, in ONE language.
 *
 * The remediation copy is READ FROM THE TOOL, not restated here. It used to be a
 * private `DORA_RECOMMENDATIONS` map that happened to match the calculator's
 * literals, which is precisely how the estimate mode and the telemetry mode come
 * to advise two different things about the same low change-failure rate.
 */
const scoreDoraQuickCheck = (f: DoraFigures, { copy: c }: DataScoreContext): ToolResult => {
  const { days } = f;
  const perWeek = f.deploymentFrequencyPerDay * 7;
  const tierLabel = (t: number) => c(`tier.${Math.max(1, Math.min(5, Math.round(t)))}`);
  const rec = (key: DoraKey | 'sustain'): ToolRecommendation =>
    ({ title: c(`rec.${key}.title`), detail: c(`rec.${key}.detail`) });
  const num = (n: number, digits = 1) => n.toLocaleString(c.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // Each key is scored only when it HAS a number. A tenant that deploys through
  // Builderforce but has not recorded a restore has no MTTR, and inventing one
  // (0h reads as Elite) would be the same lie the hand-entered default was.
  const scored: Array<{ key: DoraKey; label: string; value: string; tier: number }> = [];
  const unscored: ToolMetric[] = [];

  if (f.totalDeployments > 0) {
    scored.push({ key: 'frequency', label: c('metric.frequency'), value: c('value.perWeek', { n: num(perWeek) }), tier: doraTier.frequency(perWeek) });
  } else {
    unscored.push({ label: c('metric.frequency'), value: c('empty.deployments') });
  }
  if (f.leadTimeHours != null) {
    scored.push({ key: 'leadTime', label: c('metric.leadTime'), value: c('value.hours', { n: num(f.leadTimeHours, 0) }), tier: doraTier.leadTime(f.leadTimeHours) });
  } else {
    unscored.push({ label: c('metric.leadTime'), value: c('empty.tickets') });
  }
  if (f.changeFailureRatePct != null) {
    scored.push({ key: 'changeFailure', label: c('metric.changeFailure'), value: c('value.percent', { n: num(f.changeFailureRatePct) }), tier: doraTier.changeFailure(f.changeFailureRatePct) });
  } else {
    unscored.push({ label: c('metric.changeFailure'), value: c('empty.deployments') });
  }
  if (f.mttrHours != null) {
    scored.push({ key: 'restore', label: c('metric.restore'), value: c('value.hours', { n: num(f.mttrHours) }), tier: doraTier.restore(f.mttrHours) });
  } else {
    unscored.push({ label: c('metric.restore'), value: c('empty.restores') });
  }

  if (scored.length === 0) {
    return {
      headline: c('telemetry.headline'),
      summary: c('telemetry.summary', { days }),
      score: null, scoreLabel: null,
      metrics: [{ label: c('window'), value: c('window.days', { days }) }, ...unscored],
      recommendations: [{ title: c('telemetry.title'), detail: c('telemetry.detail') }],
    };
  }

  const overall = Math.round(scored.reduce((sum, metric) => sum + metric.tier, 0) / scored.length);
  const recommendations = scored
    .filter((metric) => metric.tier < 4)
    .sort((a, b) => a.tier - b.tier)
    .map((metric) => rec(metric.key));
  if (recommendations.length === 0) recommendations.push(rec('sustain'));

  const unmeasured = 4 - scored.length;
  return {
    headline: c('headline', { tier: tierLabel(overall) }),
    // Two whole sentences rather than one with an optional clause welded on: the
    // "not yet measurable" caveat only appears sometimes, so it has to be
    // translatable as its own sentence.
    summary: counted(c, unmeasured > 0 ? 'scored.partial' : 'scored.summary', f.totalDeployments, { days, unmeasured }),
    score: overall,
    scoreLabel: tierLabel(overall),
    metrics: [
      ...scored.map((metric) => ({ label: metric.label, value: metric.value, hint: tierLabel(metric.tier), tier: metric.tier })),
      ...unscored,
    ],
    recommendations,
  };
};

const doraQuickCheckProvider = dataProvider<DoraFigures>({
  collect: collectDoraQuickCheck,
  score: scoreDoraQuickCheck,
});

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
interface AiSpendFigures {
  days: number;
  forProject: boolean;
  calls: number;
  costUsd: number;
  tokens: number;
  promptTokens: number;
  cacheReadTokens: number;
  byoCalls: number;
  attributedTasks: number;
  completedTickets: number;
}

const collectAiSpend = async (db: Db, tenantId: number, days: number, projectId?: number | null): Promise<AiSpendFigures> => {
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
  return {
    days,
    forProject,
    calls,
    costUsd: Number(usage?.millicents ?? 0) / MILLICENTS_PER_USD,
    tokens: Number(usage?.tokens) || 0,
    promptTokens: Number(usage?.promptTokens) || 0,
    cacheReadTokens: Number(usage?.cacheReadTokens) || 0,
    byoCalls: Number(usage?.byoCalls) || 0,
    attributedTasks: Number(usage?.attributedTasks) || 0,
    completedTickets: Number(delivered?.completed) || 0,
  };
};

/** Pure: attributed spend → the cost scorecard, in ONE language. */
const scoreAiSpend = (f: AiSpendFigures, { copy: c }: DataScoreContext): ToolResult => {
  const { days, calls } = f;
  // Money renders in the READER's numbering — a German reader expects
  // `1.234,56 $`, and a stored figure that only ever rendered `en-US` was half
  // the reason a saved snapshot read as somebody else's.
  const amount = (n: number) => money(n, c.locale);
  const int = (n: number) => n.toLocaleString(c.locale);

  if (calls === 0) {
    return {
      headline: c('empty.headline'),
      summary: c(f.forProject ? 'empty.summaryProject' : 'empty.summary', { days }),
      score: null, scoreLabel: null,
      metrics: [
        { label: c('window'), value: c('window.days', { days }) },
        { label: c('metric.calls'), value: int(0) },
      ],
      recommendations: [{ title: c('empty.title'), detail: c('empty.detail') }],
    };
  }

  // Cache hit rate measured the way the estimator asks for it: the share of
  // PROMPT tokens served from cache (cache reads are a subset of prompt tokens).
  const cacheHitPct = f.promptTokens > 0 ? (f.cacheReadTokens / f.promptTokens) * 100 : 0;
  const perMonth = f.costUsd * (30 / Math.max(days, 1));
  const completed = f.completedTickets;
  const pct = (n: number) => c('value.percent', { n: n.toLocaleString(c.locale, { maximumFractionDigits: 0 }) });

  const recommendations: ToolRecommendation[] = [];
  if (cacheHitPct < 40) {
    recommendations.push({ title: c('rec.cache.title'), detail: c('rec.cache.detail', { pct: cacheHitPct.toLocaleString(c.locale, { maximumFractionDigits: 0 }) }) });
  }
  if (f.attributedTasks === 0) {
    recommendations.push({ title: c('rec.attribute.title'), detail: c('rec.attribute.detail') });
  }
  if (completed > 0) {
    recommendations.push({ title: c('rec.outcome.title'), detail: counted(c, 'rec.outcome.detail', completed, { amount: amount(f.costUsd) }) });
  }
  if (f.byoCalls > 0) {
    recommendations.push({ title: c('rec.byo.title'), detail: c('rec.byo.detail', { byo: int(f.byoCalls), calls: int(calls) }) });
  }
  if (recommendations.length === 0) {
    recommendations.push({ title: c('rec.measured.title'), detail: c('rec.measured.detail') });
  }

  return {
    headline: c('headline', { amount: amount(perMonth) }),
    summary: c('summary', { days }),
    score: null,
    scoreLabel: null,
    metrics: [
      { label: c('metric.spend'), value: amount(f.costUsd) },
      { label: c('metric.projected'), value: amount(perMonth) },
      { label: c('metric.tokens'), value: c('value.millions', { n: (f.tokens / 1_000_000).toLocaleString(c.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) },
      { label: c('metric.cache'), value: pct(cacheHitPct) },
      { label: c('metric.calls'), value: int(calls) },
      { label: c('metric.attributed'), value: int(f.attributedTasks) },
      ...(completed > 0 ? [{ label: c('metric.perTicket'), value: amount(f.costUsd / completed) }] : []),
      ...(f.byoCalls > 0 ? [{ label: c('metric.byo'), value: c('value.byo', { n: int(f.byoCalls) }) }] : []),
    ],
    recommendations,
  };
};

const aiCostEstimatorProvider = dataProvider<AiSpendFigures>({
  collect: collectAiSpend,
  score: scoreAiSpend,
});

export const TOOL_DATA_PROVIDERS: Record<string, ToolDataProvider> = {
  'agentic-maturity': agenticMaturityProvider,
  'ticket-role-coverage': ticketRoleCoverageProvider,
  'dora-quickcheck': doraQuickCheckProvider,
  'ai-cost-estimator': aiCostEstimatorProvider,
};

export function hasDataProvider(toolId: string): boolean {
  return toolId in TOOL_DATA_PROVIDERS;
}
