import { describe, expect, it } from 'vitest';
import { summarizeOutcomes, type OutcomeRow } from './engineeringInsights';
import { projectMonthlyBurn, budgetStatus, daysInMonth } from './financeInsights';
import { classifyToolRisk, summarizeAudit, evidencePackToCsv, type AuditRow, type EvidenceRow } from './complianceInsights';
import { computeFunnelMetrics, type IdeaRow } from './funnelInsights';

// ── Engineering (AI effectiveness) ───────────────────────────────────────────
describe('summarizeOutcomes', () => {
  const rows: OutcomeRow[] = [
    { actionType: 'feature', resolvedModel: 'a', score: 0.8, merged: true, ciGreen: true, degraded: false, steps: 10, costUsdMillicents: 100_000 },
    { actionType: 'feature', resolvedModel: 'a', score: 0.6, merged: false, ciGreen: true, degraded: false, steps: 20, costUsdMillicents: 100_000 },
    { actionType: 'bugfix', resolvedModel: 'b', score: 1.0, merged: true, ciGreen: true, degraded: true, steps: 5, costUsdMillicents: 200_000 },
  ];

  it('rolls up totals (avg score, merge rate, cost in USD)', () => {
    const r = summarizeOutcomes(rows, 30);
    expect(r.totals.runs).toBe(3);
    expect(r.totals.avgScore).toBeCloseTo((0.8 + 0.6 + 1.0) / 3);
    expect(r.totals.mergedRatePct).toBeCloseTo((2 / 3) * 100);
    expect(r.totals.costUsd).toBeCloseTo(4); // 400_000 millicents
  });

  it('buckets by model, action type, and approach (sorted by run count)', () => {
    const r = summarizeOutcomes(rows, 30);
    expect(r.byModel[0]!.model).toBe('a'); // 2 runs > 1
    expect(r.byModel[0]!.mergedRatePct).toBeCloseTo(50);
    expect(r.byApproach.find((b) => b.key === 'bugfix · b')!.mergedRatePct).toBe(100);
    expect(r.byApproach.find((b) => b.key === 'bugfix · b')!.degradedRatePct).toBe(100);
  });

  it('is empty-safe', () => {
    const r = summarizeOutcomes([], 7);
    expect(r.totals.runs).toBe(0);
    expect(r.totals.avgScore).toBe(0);
    expect(r.byModel).toEqual([]);
  });
});

// ── Finance (FinOps) ─────────────────────────────────────────────────────────
describe('FinOps math', () => {
  it('projectMonthlyBurn scales spend by elapsed→total days', () => {
    expect(projectMonthlyBurn(300, 10, 30)).toBeCloseTo(900);
    expect(projectMonthlyBurn(300, 30, 30)).toBeCloseTo(300);
    expect(projectMonthlyBurn(300, 0, 30)).toBe(300); // guard div-by-zero
  });

  it('budgetStatus classifies over / forecast-over / on-track / unset', () => {
    expect(budgetStatus(0, 50, 80)).toBe('no_budget');
    expect(budgetStatus(100, 120, 130)).toBe('over');
    expect(budgetStatus(100, 40, 130)).toBe('forecast_over');
    expect(budgetStatus(100, 40, 80)).toBe('on_track');
  });

  it('daysInMonth handles leap February and 31-day months', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('garbage')).toBe(31); // 1970-01 fallback
  });
});

// ── Compliance ───────────────────────────────────────────────────────────────
describe('compliance', () => {
  it('classifyToolRisk flags state-changing / credential tools', () => {
    expect(classifyToolRisk('Bash')).toBe('sensitive');
    expect(classifyToolRisk('delete_file')).toBe('sensitive');
    expect(classifyToolRisk('read_secret')).toBe('sensitive');
    expect(classifyToolRisk('Read')).toBe('normal');
    expect(classifyToolRisk('Grep')).toBe('normal');
  });

  it('summarizeAudit counts events, sensitive, distinct execs/agents', () => {
    const rows: AuditRow[] = [
      { toolName: 'Read', category: 'tool', agentHostId: 1, cloudAgentRef: null, executionId: 10 },
      { toolName: 'Bash', category: 'tool', agentHostId: 1, cloudAgentRef: null, executionId: 10 },
      { toolName: 'deploy', category: 'ops', agentHostId: null, cloudAgentRef: 'cloud-x', executionId: 11 },
    ];
    const s = summarizeAudit(rows, 30);
    expect(s.totalEvents).toBe(3);
    expect(s.sensitiveEvents).toBe(2); // Bash + deploy
    expect(s.distinctExecutions).toBe(2);
    expect(s.distinctAgents).toBe(2);
    expect(s.byTool[0]!.count).toBe(1);
  });

  it('evidencePackToCsv escapes quotes and emits a header', () => {
    const rows: EvidenceRow[] = [
      { ts: '2026-06-23T00:00:00.000Z', toolName: 'say "hi"', risk: 'normal', category: 'tool', agent: 'host:1', executionId: 10, durationMs: 5 },
    ];
    const csv = evidencePackToCsv(rows);
    expect(csv.split('\n')[0]).toBe('ts,tool,risk,category,agent,execution_id,duration_ms');
    expect(csv).toContain('"say ""hi"""');
  });
});

// ── Funnel ───────────────────────────────────────────────────────────────────
describe('computeFunnelMetrics', () => {
  const now = Date.UTC(2026, 5, 23);
  const d = (daysAgo: number) => new Date(now - daysAgo * 86_400_000);
  const ideas: IdeaRow[] = [
    { stage: 'idea', createdAt: d(5), stageEnteredAt: d(5) },
    { stage: 'validated', createdAt: d(20), stageEnteredAt: d(10) },
    { stage: 'shipped', createdAt: d(40), stageEnteredAt: d(8) },
    { stage: 'measured', createdAt: d(60), stageEnteredAt: d(2) },
    { stage: 'killed', createdAt: d(30), stageEnteredAt: d(15) },
  ];

  it('separates killed from active and computes idea→ship', () => {
    const f = computeFunnelMetrics(ideas, now);
    expect(f.totalIdeas).toBe(5);
    expect(f.activeIdeas).toBe(4);
    expect(f.killedCount).toBe(1);
    // shipped + measured reached "shipped" → 2 of 4 active = 50%
    expect(f.ideaToShipPct).toBeCloseTo(50);
  });

  it('cumulative reached counts decrease along the funnel', () => {
    const f = computeFunnelMetrics(ideas, now);
    const reached = (s: string) => f.stages.find((x) => x.stage === s)!.reached;
    expect(reached('idea')).toBe(4);       // all active reached "idea"
    expect(reached('validated')).toBe(3);  // validated + shipped + measured
    expect(reached('shipped')).toBe(2);    // shipped + measured
    expect(reached('measured')).toBe(1);
  });

  it('is empty-safe', () => {
    const f = computeFunnelMetrics([], now);
    expect(f.activeIdeas).toBe(0);
    expect(f.ideaToShipPct).toBeNull();
  });
});
