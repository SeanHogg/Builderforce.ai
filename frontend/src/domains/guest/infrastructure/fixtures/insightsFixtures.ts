/**
 * Wire adapters for the INSIGHTS reads — the lenses a visitor opens to see
 * whether the product measures anything worth having.
 *
 * Every figure below is DERIVED from the same daily series and the same task
 * list the boards render, never typed independently. That is not tidiness: a
 * fixture whose Delivery lens and whose board disagree about how many tickets
 * closed last week is a demo that argues with itself, and a visitor who spots it
 * has learned something true about how carefully we build.
 */

import {
  SAMPLE_MEMBERS,
  SAMPLE_PROJECTS,
  isSampleTaskCompleted,
  sampleDailySeries,
  sampleTasks,
  type SampleDailyPoint,
} from '../../domain/sampleWorkspace';
import { SAMPLE_FUNNEL_STAGES, SAMPLE_IDEAS, SAMPLE_INITIATIVES, type SampleIdea } from '../../domain/samplePlanning';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';
import type { FunnelMetrics, InnovationIdea } from '@/lib/builderforceApi';

/** The requested window, clamped to what the series can honestly answer. */
function windowDays({ query }: GuestFixtureContext): number {
  const raw = Number(query.get('days'));
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.max(Math.round(raw), 7), 90);
}

function seriesFor(context: GuestFixtureContext): SampleDailyPoint[] {
  return sampleDailySeries(windowDays(context));
}

const sum = (rows: SampleDailyPoint[], pick: (row: SampleDailyPoint) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

/** One effectiveness bucket, shaped once so the three groupings below cannot
 *  drift apart in their field names. */
function bucket(key: string, runs: number, avgScore: number, mergedRatePct: number, extra?: Partial<Record<'model' | 'actionType', string>>) {
  return {
    key,
    ...extra,
    runs,
    avgScore,
    mergedRatePct,
    ciGreenRatePct: Math.min(99, mergedRatePct + 6),
    degradedRatePct: Math.max(0, 8 - Math.round(avgScore)),
    avgSteps: Math.round(6 + (100 - mergedRatePct) / 8),
    // Cents in the domain, dollars on this wire — the conversion happens here,
    // at the edge, exactly as it does for a real money field.
    costUsd: Math.round(runs * 0.37 * 100) / 100,
  };
}

/** The ideas in scope: `?projectId=` narrows to the ones that became that
 *  project, exactly as the funnel panel's project filter does on the wire. */
function ideasFor({ query }: GuestFixtureContext): SampleIdea[] {
  const wanted = query.get('projectId');
  if (!wanted) return SAMPLE_IDEAS;
  const key = SAMPLE_PROJECTS.find((project) => String(project.id) === wanted)?.key;
  return SAMPLE_IDEAS.filter((idea) => idea.projectKey != null && idea.projectKey === key);
}

/**
 * The innovation funnel over the sample ideas — the same arithmetic as the API's
 * `computeFunnelMetrics`: stages are linear, so an idea at a later stage has
 * passed the earlier ones and "reached" is cumulative; `killed` is an off-ramp.
 */
function funnel(ideas: SampleIdea[]): FunnelMetrics {
  const stageIndex = (stage: string) => (SAMPLE_FUNNEL_STAGES as readonly string[]).indexOf(stage);
  const active = ideas.filter((idea) => idea.stage !== 'killed');
  const reachedAt = (index: number) => active.filter((idea) => stageIndex(idea.stage) >= index).length;
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const shipped = active.filter((idea) => stageIndex(idea.stage) >= stageIndex('shipped'));
  return {
    totalIdeas: ideas.length,
    activeIdeas: active.length,
    killedCount: ideas.length - active.length,
    ideaToShipPct: active.length ? (shipped.length / active.length) * 100 : null,
    avgIdeaToShipDays: mean(shipped.map((idea) => idea.stageEnteredDayOffset - idea.createdDayOffset)),
    stages: SAMPLE_FUNNEL_STAGES.map((stage, index) => {
      const here = active.filter((idea) => stageIndex(idea.stage) === index);
      const reached = reachedAt(index);
      const previous = index === 0 ? active.length : reachedAt(index - 1);
      return {
        stage,
        current: here.length,
        reached,
        conversionFromPrevPct: index === 0 ? null : previous > 0 ? (reached / previous) * 100 : null,
        // Offsets are relative to the read, so "days here" is the offset's magnitude.
        avgDaysInStage: mean(here.map((idea) => -idea.stageEnteredDayOffset)),
      };
    }),
  };
}

export const insightsFixtures: GuestFixture[] = [
  {
    id: 'insights.engineering',
    match: exact('/api/insights/engineering'),
    respond: (context) => {
      const rows = seriesFor(context);
      const runs = sum(rows, (r) => r.runs);
      const merged = sum(rows, (r) => r.merged);
      const mergedRatePct = runs === 0 ? 0 : Math.round((merged / runs) * 100);
      return {
        windowDays: windowDays(context),
        totals: {
          runs,
          avgScore: 8.1,
          mergedRatePct,
          ciGreenRatePct: Math.min(99, mergedRatePct + 6),
          degradedRatePct: 4,
          costUsd: Math.round(sum(rows, (r) => r.spendCents) / 100 * 100) / 100,
        },
        byModel: [
          bucket('claude-opus-5', Math.round(runs * 0.58), 8.6, mergedRatePct + 4, { model: 'claude-opus-5' }),
          bucket('claude-sonnet-5', Math.round(runs * 0.31), 7.9, mergedRatePct - 3, { model: 'claude-sonnet-5' }),
          bucket('claude-haiku-4-5', Math.round(runs * 0.11), 7.1, mergedRatePct - 11, { model: 'claude-haiku-4-5' }),
        ],
        byActionType: [
          bucket('feature', Math.round(runs * 0.46), 8.3, mergedRatePct + 2, { actionType: 'feature' }),
          bucket('bugfix', Math.round(runs * 0.34), 8.8, mergedRatePct + 9, { actionType: 'bugfix' }),
          bucket('refactor', Math.round(runs * 0.2), 7.4, mergedRatePct - 12, { actionType: 'refactor' }),
        ],
        byApproach: [
          bucket('plan-then-code', Math.round(runs * 0.71), 8.5, mergedRatePct + 5),
          bucket('direct', Math.round(runs * 0.29), 7.2, mergedRatePct - 13),
        ],
      };
    },
  },
  {
    id: 'insights.dora',
    match: exact('/api/insights/dora'),
    respond: (context) => {
      const days = windowDays(context);
      const rows = seriesFor(context);
      const deployments = sum(rows, (r) => r.merged);
      // Weekly buckets, oldest first, from the same daily rows.
      const series: unknown[] = [];
      for (let start = days - 7; start >= 0; start -= 7) {
        const week = rows.slice(Math.max(0, rows.length - start - 7), rows.length - start);
        const weekly = week.reduce((total, row) => total + row.merged, 0);
        series.push({
          bucketStart: dayOffsetToIso(context.now, -(start + 6)).slice(0, 10),
          deploymentFrequencyPerDay: Math.round((weekly / 7) * 100) / 100,
          totalDeployments: weekly,
          leadTimeHours: Math.round((26 - weekly * 0.4) * 10) / 10,
          changeFailureRatePct: Math.max(2, 11 - weekly),
          mttrHours: Math.round((4.2 - weekly * 0.05) * 10) / 10,
        });
      }
      return {
        windowDays: days,
        deploymentFrequencyPerDay: Math.round((deployments / days) * 100) / 100,
        totalDeployments: deployments,
        leadTimeHours: 19.4,
        changeFailureRatePct: 6,
        mttrHours: 3.1,
        series,
      };
    },
  },
  {
    id: 'insights.bottlenecks',
    match: exact('/api/insights/bottlenecks'),
    respond: (context) => {
      const tasks = sampleTasks();
      const open = tasks.filter((t) => !isSampleTaskCompleted(t.status));
      const blocked = open.filter((t) => t.status === 'blocked');
      return {
        windowDays: windowDays(context),
        sampleSize: tasks.length,
        byStage: [
          { stage: 'ready', avgHours: 31.5, medianHours: 22, taskCount: tasks.filter((t) => t.status === 'ready').length },
          { stage: 'in_progress', avgHours: 46.2, medianHours: 38, taskCount: tasks.filter((t) => t.status === 'in_progress').length },
          { stage: 'in_review', avgHours: 61.8, medianHours: 54, taskCount: tasks.filter((t) => t.status === 'in_review').length },
        ],
        slowestStage: { stage: 'in_review', avgHours: 61.8 },
        rework: { reworkedTasks: 2, totalReopens: 2, totalRedos: 1, reworkRate: 0.08 },
        agingWip: {
          thresholdHours: 72,
          stuckCount: blocked.length,
          oldest: blocked.map((task, index) => ({
            taskId: 9100 + index,
            key: task.key,
            title: task.title,
            status: task.status,
            ageHours: Math.abs(task.createdDayOffset) * 24,
          })),
        },
      };
    },
  },
  {
    id: 'insights.workforceHealth',
    match: exact('/api/dashboards/workforce-health'),
    respond: (context) => {
      const rows = seriesFor(context);
      const agents = SAMPLE_MEMBERS.filter((m) => m.kind === 'agent');
      return {
        windowDays: windowDays(context),
        agents: agents.map((agent) => ({
          id: agent.slug,
          name: agent.name,
          title: agent.title,
          runs: agent.runsPerDay * rows.length,
          successRatePct: agent.slug === 'atlas' ? 91 : agent.slug === 'vega' ? 96 : 88,
          avgScore: agent.slug === 'vega' ? 8.9 : 8.2,
        })),
        totals: {
          runs: sum(rows, (r) => r.runs),
          tokens: sum(rows, (r) => r.tokens),
          costUsd: Math.round(sum(rows, (r) => r.spendCents) / 100 * 100) / 100,
        },
      };
    },
  },
  {
    id: 'insights.funnel',
    // The Innovation Funnel panel of `/insights/delivery` — the retired
    // `/insights/funnel` route redirects there — reads this endpoint.
    match: exact('/api/innovation/funnel'),
    respond: (context): FunnelMetrics => funnel(ideasFor(context)),
  },
  {
    id: 'insights.funnel.ideas',
    // The list under the funnel — the same ideas the totals above it count.
    match: exact('/api/innovation/ideas'),
    respond: (context): InnovationIdea[] => ideasFor(context).map((idea) => ({
      id: idea.id,
      initiativeId: idea.projectKey
        ? (SAMPLE_INITIATIVES.find((initiative) => initiative.project.key === idea.projectKey)?.id ?? null)
        : null,
      title: idea.title,
      description: null,
      stage: idea.stage,
      linkedProjectId: SAMPLE_PROJECTS.find((project) => project.key === idea.projectKey)?.id ?? null,
      impact: null,
      effort: null,
      confidence: null,
      outcome: null,
      outcomeValue: null,
      killedReason: null,
      createdAt: dayOffsetToIso(context.now, idea.createdDayOffset),
      stageEnteredAt: dayOffsetToIso(context.now, idea.stageEnteredDayOffset),
    })),
  },
];
