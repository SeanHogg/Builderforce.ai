/**
 * @vitest-environment jsdom
 *
 * The money lenses, answered from the sample workspace.
 *
 * Coverage first — each of these was a signed-out visitor looking at an empty
 * chart under a banner promising them a sample workspace — and then the property
 * that actually keeps a fixture honest: every total is DERIVED from the same
 * series and the same tickets the other lenses read, so the demo cannot argue
 * with itself. A hand-typed total is how a fixture starts lying the day somebody
 * adds a row, so each assertion below re-computes rather than restates.
 */
import { describe, it, expect } from 'vitest';
import { resolveGuestRead } from '../../application/guestRead';
import { allGuestFixtures } from '../guestFixtureRegistry';
import { SAMPLE_MEMBERS, SAMPLE_PROJECTS, sampleDailySeries, sampleTasks } from '../../domain/sampleWorkspace';

const read = (path: string) => resolveGuestRead({ path, method: 'GET', hadToken: false });

describe('finance, allocation and planning fixtures', () => {
  it('answers every read the money and planning lenses fire', () => {
    for (const path of [
      '/api/insights/finance',
      '/api/insights/compliance?days=30',
      '/api/insights/allocation?days=30',
      '/api/agents',
      '/api/pmo/tree',
      '/api/pmo/rollup?kind=workspace',
    ]) {
      expect(read(path), path).not.toBeNull();
    }
  });

  it('keeps every fixture id unique across the whole registry', () => {
    const ids = allGuestFixtures().map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports finance spend as the series total, in dollars, not a typed figure', () => {
    const body = read('/api/insights/finance')!.body as {
      totals: { spendUsd: number; mergedRuns: number; costPerMergedPrUsd: number | null };
      daily: Array<{ date: string; usd: number }>;
      byProject: Array<{ usd: number }>;
    };
    const series = sampleDailySeries(30);
    const spendCents = series.reduce((total, row) => total + row.spendCents, 0);
    expect(body.totals.spendUsd).toBe(Math.round(spendCents) / 100);
    expect(body.totals.mergedRuns).toBe(series.reduce((total, row) => total + row.merged, 0));
    // Cost per merged PR is a QUOTIENT of the two totals above, so it cannot
    // drift from them; and it is null rather than Infinity when nothing merged.
    expect(body.totals.costPerMergedPrUsd).toBe(Math.round(spendCents / body.totals.mergedRuns) / 100);
    expect(body.daily).toHaveLength(series.length);
    // Per-project spend sums back to the total it was apportioned from, within
    // the rounding a per-project split legitimately costs.
    const byProject = body.byProject.reduce((total, row) => total + row.usd, 0);
    expect(Math.abs(byProject - body.totals.spendUsd)).toBeLessThan(SAMPLE_PROJECTS.length);
  });

  it('honours the compliance window rather than answering the same figures for every range', () => {
    const short = read('/api/insights/compliance?days=7')!.body as { windowDays: number; totalEvents: number };
    const long = read('/api/insights/compliance?days=90')!.body as { windowDays: number; totalEvents: number };
    expect(short.windowDays).toBe(7);
    expect(long.windowDays).toBe(90);
    expect(long.totalEvents).toBeGreaterThan(short.totalEvents);
  });

  it('tallies the compliance breakdown back to the events it counted', () => {
    const body = read('/api/insights/compliance?days=30')!.body as {
      totalEvents: number; sensitiveEvents: number; distinctAgents: number;
      byTool: Array<{ toolName: string; risk: string; count: number }>;
      byAgent: Array<{ count: number }>;
    };
    const tallied = body.byTool.reduce((total, row) => total + row.count, 0);
    // Rounding a weighted split costs at most one event per tool.
    expect(Math.abs(tallied - body.totalEvents)).toBeLessThanOrEqual(body.byTool.length);
    expect(body.sensitiveEvents).toBe(
      body.byTool.filter((row) => row.risk === 'sensitive').reduce((total, row) => total + row.count, 0),
    );
    expect(body.byAgent).toHaveLength(SAMPLE_MEMBERS.filter((member) => member.kind === 'agent').length);
    expect(body.distinctAgents).toBe(body.byAgent.length);
    // The tool mix is a distribution, not a flat split — the shape a reviewer
    // is actually reading for.
    expect(body.byTool[0].count).toBeGreaterThan(body.byTool[body.byTool.length - 1].count * 2);
  });

  it('splits allocation into capex and opex that sum back to the whole', () => {
    const body = read('/api/insights/allocation?days=30')!.body as {
      totals: {
        hours: number; costUsd: number; capexUsd: number; opexUsd: number;
        capitalizablePct: number; loggedHours: number; measuredEffortPct: number;
        byStatus: Record<string, { hours: number; taskCount: number }>;
      };
      byCategory: Array<{ hours: number; pct: number; capexUsd: number; opexUsd: number }>;
      byMember: Array<{ totalHours: number }>;
    };
    expect(Math.abs((body.totals.capexUsd + body.totals.opexUsd) - body.totals.costUsd)).toBeLessThan(1);
    // Category hours sum to the total, and the percentages are that ratio —
    // never a second, independently-typed number.
    const categoryHours = body.byCategory.reduce((total, row) => total + row.hours, 0);
    expect(categoryHours).toBe(body.totals.hours);
    expect(body.byMember.reduce((total, row) => total + row.totalHours, 0)).toBe(body.totals.hours);
    // Capitalized + not-capitalized partition the hours; nothing is uncategorized
    // in a workspace whose every ticket the fixture itself classified.
    const { capitalized, not_capitalized: notCapitalized, uncategorized } = body.totals.byStatus;
    expect(capitalized.hours + notCapitalized.hours).toBe(body.totals.hours);
    expect(uncategorized.hours).toBe(0);
    // measuredEffortPct is the logged share — the one figure that says whether a
    // capitalization claim is measured or modelled.
    expect(body.totals.measuredEffortPct)
      .toBe(Math.round((body.totals.loggedHours / body.totals.hours) * 100));
    expect(body.totals.capitalizablePct).toBeGreaterThan(0);
    expect(body.totals.capitalizablePct).toBeLessThan(100);
  });

  it('lists only agents on the agent endpoint, from the roster the board renders', () => {
    const body = read('/api/agents')!.body as Array<{ id: number; name: string; isActive: boolean }>;
    const agents = SAMPLE_MEMBERS.filter((member) => member.kind === 'agent');
    expect(body.map((row) => row.name)).toEqual(agents.map((member) => member.name));
    expect(body.every((row) => row.isActive)).toBe(true);
    expect(new Set(body.map((row) => row.id)).size).toBe(body.length);
    // The human seat is not an agent, and offering it here would put the
    // visitor in their own assignee picker as a bot.
    expect(body.some((row) => row.name === 'You')).toBe(false);
  });

  it('gives the planning tree real edges rather than three flat lists', () => {
    const body = read('/api/pmo/tree')!.body as {
      portfolios: Array<{ id: string }>;
      initiatives: Array<{ id: string; portfolioId: string | null }>;
      projects: Array<{ id: number; initiativeId: string | null }>;
      dependencies: Array<{ fromInitiativeId: string; toInitiativeId: string }>;
    };
    const portfolioIds = new Set(body.portfolios.map((row) => row.id));
    const initiativeIds = new Set(body.initiatives.map((row) => row.id));
    expect(body.initiatives.every((row) => row.portfolioId != null && portfolioIds.has(row.portfolioId))).toBe(true);
    expect(body.projects.every((row) => row.initiativeId != null && initiativeIds.has(row.initiativeId))).toBe(true);
    expect(body.projects.map((row) => row.id).sort()).toEqual(SAMPLE_PROJECTS.map((p) => p.id).sort());
    // Every dependency points at initiatives that exist, and never at itself.
    for (const edge of body.dependencies) {
      expect(initiativeIds.has(edge.fromInitiativeId)).toBe(true);
      expect(initiativeIds.has(edge.toInitiativeId)).toBe(true);
      expect(edge.fromInitiativeId).not.toBe(edge.toInitiativeId);
    }
  });

  it('derives the PMO rollup from the same tickets the board shows', () => {
    const body = read('/api/pmo/rollup?kind=workspace')!.body as {
      projectCount: number;
      delivery: { totalTasks: number; completedCount: number; openCount: number; avgCycleTimeHours: number };
      spend: { agentLlmCostUsd: number };
    };
    const tasks = sampleTasks();
    expect(body.projectCount).toBe(SAMPLE_PROJECTS.length);
    expect(body.delivery.totalTasks).toBe(tasks.length);
    expect(body.delivery.completedCount + body.delivery.openCount).toBe(tasks.length);
    expect(body.delivery.avgCycleTimeHours).toBeGreaterThan(0);
    // The rollup's spend is the same money the finance lens reports.
    const finance = read('/api/insights/finance')!.body as { totals: { spendUsd: number } };
    expect(body.spend.agentLlmCostUsd).toBe(finance.totals.spendUsd);
  });
});
