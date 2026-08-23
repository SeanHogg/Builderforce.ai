/**
 * Wire adapters for the MONEY lenses — Finance, Allocation and Compliance.
 *
 * These three were the highest-value gap left by the guest-preview pass: a
 * visitor could open `/insights/finance` and see an empty chart, which reads as
 * "this product does not measure spend" rather than as "you are not signed in".
 *
 * ── ONE SERIES, THREE LENSES ─────────────────────────────────────────────────
 * Every figure below is DERIVED from `sampleDailySeries` and `sampleTasks` — the
 * same two sources the Delivery and Engineering lenses read. That is the whole
 * discipline of this module: spend on the Finance lens is the same spend the
 * Engineering lens totals, and the hours Allocation capitalizes are the same
 * tickets the board renders. A fixture that types its own numbers is a demo that
 * argues with itself, and the visitor who notices has learned something true.
 *
 * ── MONEY IS CENTS UNTIL THE EDGE ────────────────────────────────────────────
 * `spendCents` is integer cents in the domain, exactly as it is in production.
 * The conversion to dollars happens HERE, in the adapter, because that is where
 * it happens for a real read — so a rounding difference between the fixture and
 * the wire is impossible rather than merely unlikely.
 */

import {
  SAMPLE_MEMBERS,
  SAMPLE_PROJECTS,
  isSampleTaskCompleted,
  sampleDailySeries,
  sampleTasks,
  type SampleDailyPoint,
  type SampleTaskStatus,
} from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';

/** The requested window, clamped to what the series can honestly answer. */
function windowDays({ query }: GuestFixtureContext): number {
  const raw = Number(query.get('days'));
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(Math.max(Math.round(raw), 7), 90);
}

const sum = (rows: SampleDailyPoint[], pick: (row: SampleDailyPoint) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

/** Cents → dollars, rounded to the cent. The ONE conversion in this module. */
const usd = (cents: number): number => Math.round(cents) / 100;

/** `YYYY-MM` for the read's own clock — the period a finance lens defaults to. */
function periodMonth(now: number): string {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Allocation — how effort splits, and how much of it may be capitalized
// ---------------------------------------------------------------------------

/**
 * Which capitalization category a ticket's work belongs to.
 *
 * Derived from the ticket rather than assigned at random, because the Allocation
 * lens exists to answer "where did the quarter go" and a random split answers
 * nothing. An epic is planning (`ktlo`); a blocked ticket is support; everything
 * else splits by its project, which is what makes the storefront project read as
 * new build and the platform project as maintenance.
 */
type Category = 'innovation' | 'ktlo' | 'support' | 'tech_debt' | 'other';

const CATEGORY_LABEL: Record<Category, string> = {
  innovation: 'Innovation',
  ktlo: 'Keep the lights on',
  support: 'Support',
  tech_debt: 'Tech debt',
  other: 'Other',
};

/** Only `innovation` and `tech_debt` effort is capitalizable — the same rule the
 *  real collector applies, stated once here so the three roll-ups below agree. */
const CAPITALIZABLE: ReadonlySet<Category> = new Set<Category>(['innovation', 'tech_debt']);

function categoryFor(task: { epic?: boolean; status: SampleTaskStatus; projectKey: string; title: string }): Category {
  if (task.epic) return 'ktlo';
  if (task.status === 'blocked') return 'support';
  if (/refactor|debt|cleanup|migrat|upgrade/i.test(task.title)) return 'tech_debt';
  return task.projectKey === 'SHOP' ? 'innovation' : 'ktlo';
}

/** Hours for a ticket. Points where they exist, a flat estimate where they do
 *  not — and the split between the two is what `measuredEffortPct` reports. */
function hoursFor(task: { points?: number }): { hours: number; logged: boolean } {
  return task.points != null ? { hours: task.points * 6, logged: true } : { hours: 8, logged: false };
}

/** A member's modelled hourly rate in cents. Agents cost compute, not salary, so
 *  only the human seat carries one — which is precisely why `laborUsd` and
 *  `costUsd` are different numbers on this lens. */
const RATE_CENTS_PER_HOUR = 11_000;

interface AllocationRow {
  category: Category;
  hours: number;
  loggedHours: number;
  taskCount: number;
  costCents: number;
  memberSlug: string;
}

function allocationRows(context: GuestFixtureContext): AllocationRow[] {
  const days = windowDays(context);
  const series = sampleDailySeries(days);
  const totalSpendCents = sum(series, (row) => row.spendCents);
  const tasks = sampleTasks().filter((task) => task.createdDayOffset >= -days);
  const totalHours = tasks.reduce((total, task) => total + hoursFor(task).hours, 0) || 1;

  // Compute spend is apportioned BY EFFORT rather than split evenly: a ticket
  // that took three times the hours consumed roughly three times the model
  // calls, which is the relationship the real collector measures.
  return tasks.map((task) => {
    const { hours, logged } = hoursFor(task);
    return {
      category: categoryFor(task),
      hours,
      loggedHours: logged ? hours : 0,
      taskCount: 1,
      costCents: Math.round(totalSpendCents * (hours / totalHours)),
      memberSlug: task.assignee,
    };
  });
}

function fold<K extends string>(rows: AllocationRow[], key: (row: AllocationRow) => K) {
  const out = new Map<K, { hours: number; loggedHours: number; taskCount: number; costCents: number }>();
  for (const row of rows) {
    const k = key(row);
    const acc = out.get(k) ?? { hours: 0, loggedHours: 0, taskCount: 0, costCents: 0 };
    acc.hours += row.hours;
    acc.loggedHours += row.loggedHours;
    acc.taskCount += row.taskCount;
    acc.costCents += row.costCents;
    out.set(k, acc);
  }
  return out;
}

/** One FTE-month, so `fteMonths` means the same thing here as on the real lens. */
const HOURS_PER_FTE_MONTH = 160;

function statusBucket(rows: AllocationRow[]) {
  const hours = rows.reduce((t, r) => t + r.hours, 0);
  const loggedHours = rows.reduce((t, r) => t + r.loggedHours, 0);
  const ratedHours = rows.filter((r) => r.memberSlug === 'human').reduce((t, r) => t + r.hours, 0);
  return {
    hours,
    fteMonths: Math.round((hours / HOURS_PER_FTE_MONTH) * 100) / 100,
    costUsd: usd(rows.reduce((t, r) => t + r.costCents, 0)),
    taskCount: rows.length,
    laborUsd: usd(ratedHours * RATE_CENTS_PER_HOUR),
    ratedHours,
    loggedHours,
  };
}

export const financeFixtures: GuestFixture[] = [
  {
    id: 'insights.finance',
    match: exact('/api/insights/finance'),
    respond: (context) => {
      // The finance lens is PERIOD-scoped, not window-scoped, so it reads the
      // full 30-day series regardless of a `days` parameter — the same shape the
      // real endpoint has, where `?period=YYYY-MM` selects a month.
      const series = sampleDailySeries(30);
      const spendCents = sum(series, (row) => row.spendCents);
      const mergedRuns = sum(series, (row) => row.merged);
      // A forecast is the trailing daily mean projected to a 30-day month —
      // which is what makes it move when the series does.
      const forecastCents = Math.round((spendCents / series.length) * 30);

      const tasks = sampleTasks();
      const byProject = SAMPLE_PROJECTS.map((project) => {
        const share = tasks.filter((task) => task.projectId === project.id).length / (tasks.length || 1);
        return { projectId: project.id, projectName: project.name, usd: usd(Math.round(spendCents * share)) };
      }).sort((a, b) => b.usd - a.usd);

      return {
        periodMonth: periodMonth(context.now),
        totals: {
          spendUsd: usd(spendCents),
          forecastUsd: usd(forecastCents),
          // Nothing in the sample workspace overflows to a paid pool — a
          // fictional overflow charge would be the one number here a visitor
          // could reasonably be annoyed to discover was invented.
          paidOverflowUsd: 0,
          cacheReadTokens: Math.round(sum(series, (row) => row.tokens) * 0.34),
          cacheCreationTokens: Math.round(sum(series, (row) => row.tokens) * 0.08),
          costPerMergedPrUsd: mergedRuns === 0 ? null : usd(Math.round(spendCents / mergedRuns)),
          mergedRuns,
        },
        daily: series.map((row) => ({
          date: dayOffsetToIso(context.now, row.dayOffset).slice(0, 10),
          usd: usd(row.spendCents),
        })),
        byProject,
        // A budget line the workspace has not set is honestly absent rather than
        // invented: an imaginary budget makes the variance column fiction.
        budgets: [],
      };
    },
  },

  {
    id: 'insights.compliance',
    match: exact('/api/insights/compliance'),
    respond: (context) => {
      const days = windowDays(context);
      const series = sampleDailySeries(days);
      const totalEvents = sum(series, (row) => row.runs) * 3;
      const agents = SAMPLE_MEMBERS.filter((member) => member.kind === 'agent');
      const agentRuns = agents.reduce((total, agent) => total + agent.runsPerDay * days, 0) || 1;

      // The tool mix is a SHAPE, not a list of favourites: reads dominate,
      // writes are a minority, and the two genuinely sensitive tools are a small
      // tail. That is the distribution a compliance reviewer is checking for,
      // and a flat split would tell them nothing.
      const byTool = [
        { toolName: 'read_file', risk: 'normal' as const, weight: 0.34 },
        { toolName: 'search_code', risk: 'normal' as const, weight: 0.21 },
        { toolName: 'write_file', risk: 'sensitive' as const, weight: 0.14 },
        { toolName: 'run_checks', risk: 'normal' as const, weight: 0.12 },
        { toolName: 'create_pull_request', risk: 'sensitive' as const, weight: 0.09 },
        { toolName: 'list_files', risk: 'normal' as const, weight: 0.07 },
        { toolName: 'tasks_update', risk: 'normal' as const, weight: 0.03 },
      ].map(({ toolName, risk, weight }) => ({ toolName, risk, count: Math.round(totalEvents * weight) }));

      const sensitiveEvents = byTool
        .filter((tool) => tool.risk === 'sensitive')
        .reduce((total, tool) => total + tool.count, 0);

      return {
        windowDays: days,
        totalEvents,
        sensitiveEvents,
        distinctExecutions: sum(series, (row) => row.runs),
        distinctAgents: agents.length,
        byTool: byTool.sort((a, b) => b.count - a.count),
        byCategory: [
          { category: 'repository', count: byTool.filter((t) => /file|code|list/.test(t.toolName)).reduce((s, t) => s + t.count, 0) },
          { category: 'delivery', count: byTool.filter((t) => /pull_request|tasks/.test(t.toolName)).reduce((s, t) => s + t.count, 0) },
          { category: 'verification', count: byTool.filter((t) => /checks/.test(t.toolName)).reduce((s, t) => s + t.count, 0) },
        ].filter((row) => row.count > 0),
        byAgent: agents.map((agent) => ({
          agent: agent.name,
          kind: 'cloud' as const,
          count: Math.round(totalEvents * ((agent.runsPerDay * days) / agentRuns)),
        })),
      };
    },
  },

  {
    id: 'insights.allocation',
    match: exact('/api/insights/allocation'),
    respond: (context) => {
      const days = windowDays(context);
      const rows = allocationRows(context);
      const hours = rows.reduce((total, row) => total + row.hours, 0);
      const loggedHours = rows.reduce((total, row) => total + row.loggedHours, 0);
      const ratedHours = rows.filter((row) => row.memberSlug === 'human').reduce((t, r) => t + r.hours, 0);
      const costCents = rows.reduce((total, row) => total + row.costCents, 0);
      const capitalizableHours = rows.filter((row) => CAPITALIZABLE.has(row.category)).reduce((t, r) => t + r.hours, 0);

      const byCategoryFold = fold(rows, (row) => row.category);
      const byCategory = [...byCategoryFold.entries()]
        .map(([category, acc]) => ({
          category,
          label: CATEGORY_LABEL[category],
          hours: acc.hours,
          pct: hours === 0 ? 0 : Math.round((acc.hours / hours) * 100),
          taskCount: acc.taskCount,
          costUsd: usd(acc.costCents),
          capexUsd: CAPITALIZABLE.has(category) ? usd(acc.costCents) : 0,
          opexUsd: CAPITALIZABLE.has(category) ? 0 : usd(acc.costCents),
        }))
        .sort((a, b) => b.hours - a.hours);

      const byMemberFold = fold(rows, (row) => row.memberSlug);
      const byMember = [...byMemberFold.entries()]
        .map(([slug, acc]) => {
          const member = SAMPLE_MEMBERS.find((m) => m.slug === slug);
          const mine = rows.filter((row) => row.memberSlug === slug);
          const spread = fold(mine, (row) => row.category);
          return {
            memberKind: member?.kind ?? 'agent',
            memberRef: slug,
            memberName: member?.name ?? slug,
            totalHours: acc.hours,
            categorySpread: spread.size,
            byCategory: [...spread.entries()].map(([category, sub]) => ({
              category,
              label: CATEGORY_LABEL[category],
              hours: sub.hours,
              pct: acc.hours === 0 ? 0 : Math.round((sub.hours / acc.hours) * 100),
            })),
          };
        })
        .sort((a, b) => b.totalHours - a.totalHours);

      const capitalized = rows.filter((row) => CAPITALIZABLE.has(row.category));
      const notCapitalized = rows.filter((row) => !CAPITALIZABLE.has(row.category));

      return {
        windowDays: days,
        totals: {
          hours,
          taskCount: rows.length,
          costUsd: usd(costCents),
          capexUsd: usd(capitalized.reduce((t, r) => t + r.costCents, 0)),
          opexUsd: usd(notCapitalized.reduce((t, r) => t + r.costCents, 0)),
          capitalizablePct: hours === 0 ? 0 : Math.round((capitalizableHours / hours) * 100),
          laborUsd: usd(ratedHours * RATE_CENTS_PER_HOUR),
          ratedHours,
          loggedHours,
          measuredEffortPct: hours === 0 ? 0 : Math.round((loggedHours / hours) * 100),
          byStatus: {
            capitalized: statusBucket(capitalized),
            not_capitalized: statusBucket(notCapitalized),
            uncategorized: statusBucket([]),
          },
        },
        byCategory,
        byMember,
        epics: sampleTasks()
          .filter((task) => task.epic)
          .map((task) => {
            const children = sampleTasks().filter((child) => child.parentKey === task.key);
            const epicHours = children.reduce((total, child) => total + hoursFor(child).hours, 0);
            const category = categoryFor(task);
            return {
              epicId: Number(task.key.replace(/\D+/g, '')) || 0,
              title: task.title,
              status: (CAPITALIZABLE.has(category) ? 'capitalized' : 'not_capitalized') as 'capitalized' | 'not_capitalized',
              source: 'derived' as const,
              hours: epicHours,
              fteMonths: Math.round((epicHours / HOURS_PER_FTE_MONTH) * 100) / 100,
              costUsd: usd(Math.round(costCents * (epicHours / (hours || 1)))),
              taskCount: children.length,
              projectName: task.projectName,
            };
          })
          .filter((epic) => epic.taskCount > 0),
      };
    },
  },

  {
    id: 'agents.list',
    match: exact('/api/agents'),
    // The workforce agent list, which several surfaces read to populate an
    // assignee picker. Derived from the SAME roster the Workforce lens renders,
    // so a visitor cannot be offered an assignee the board has never heard of.
    // The human seat is deliberately absent: this endpoint lists AGENTS.
    respond: () =>
      SAMPLE_MEMBERS.filter((member) => member.kind === 'agent').map((member, index) => ({
        id: 9100 + index,
        name: member.name,
        type: member.title,
        isActive: true,
      })),
  },

  {
    id: 'pmo.tree',
    match: exact('/api/pmo/tree'),
    // The planning spine. One portfolio holding one initiative per sample
    // project, so the tree has real edges rather than a flat list — a
    // hierarchy view with no hierarchy in it demonstrates nothing.
    respond: (context) => ({
      portfolios: [
        {
          id: 'sample-portfolio-1',
          name: 'FY Commerce Platform',
          description: 'Everything the storefront and the platform teams are accountable for this year.',
          status: 'active',
          targetDate: dayOffsetToIso(context.now, 120).slice(0, 10),
        },
      ],
      initiatives: SAMPLE_PROJECTS.map((project, index) => ({
        id: `sample-initiative-${project.id}`,
        name: project.name,
        description: project.description,
        status: project.status,
        portfolioId: 'sample-portfolio-1',
        targetDate: dayOffsetToIso(context.now, 45 + index * 30).slice(0, 10),
        projectCount: 1,
      })),
      projects: SAMPLE_PROJECTS.map((project) => ({
        id: project.id,
        name: project.name,
        key: project.key,
        status: project.status,
        initiativeId: `sample-initiative-${project.id}`,
      })),
      // A dependency between the first two initiatives, so the graph draws an
      // edge. With one project there is nothing to depend on and the list is
      // correctly empty rather than self-referential.
      dependencies: SAMPLE_PROJECTS.length >= 2
        ? [{
            id: 'sample-dependency-1',
            fromInitiativeId: `sample-initiative-${SAMPLE_PROJECTS[1].id}`,
            toInitiativeId: `sample-initiative-${SAMPLE_PROJECTS[0].id}`,
          }]
        : [],
    }),
  },

  {
    id: 'pmo.rollup',
    match: exact('/api/pmo/rollup'),
    respond: (context) => {
      const days = windowDays(context);
      const series = sampleDailySeries(days);
      const tasks = sampleTasks();
      const completed = tasks.filter((task) => isSampleTaskCompleted(task.status));
      // Cycle time from the tickets' OWN offsets, so the number the rollup
      // reports is the one the board's dates would produce if measured.
      const cycleHours = completed
        .filter((task) => task.completedDayOffset != null)
        .map((task) => (task.completedDayOffset! - task.createdDayOffset) * 24);
      const avgCycleTimeHours = cycleHours.length === 0
        ? 0
        : Math.round(cycleHours.reduce((total, hours) => total + hours, 0) / cycleHours.length);

      return {
        scope: { kind: 'workspace', id: 'sample', name: 'Nova Commerce (Sample)' },
        projectCount: SAMPLE_PROJECTS.length,
        initiativeCount: SAMPLE_PROJECTS.length,
        delivery: {
          totalTasks: tasks.length,
          completedCount: completed.length,
          openCount: tasks.length - completed.length,
          avgCycleTimeHours,
          throughputPerWeek: Math.round((sum(series, (row) => row.completed) / days) * 7),
        },
        spend: { agentLlmCostUsd: usd(sum(series, (row) => row.spendCents)) },
      };
    },
  },
];
