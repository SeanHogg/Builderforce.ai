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
  isSampleTaskCompleted,
  sampleDailySeries,
  sampleTasks,
  type SampleDailyPoint,
} from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';

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
];
