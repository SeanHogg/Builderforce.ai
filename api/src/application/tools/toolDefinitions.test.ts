import { describe, it, expect } from 'vitest';
import { TOOLS, getTool } from './toolDefinitions';
import { toDefinition, type CalculatorTool, type QuestionnaireTool } from './toolTypes';

describe('tools registry', () => {
  it('exposes client-safe definitions without the compute fn', () => {
    for (const t of TOOLS) {
      const def = toDefinition(t) as unknown as Record<string, unknown>;
      expect(def.id).toBe(t.id);
      expect('compute' in def).toBe(false);
      expect('score' in def).toBe(false);
    }
  });
});

describe('dora-quickcheck', () => {
  const tool = getTool('dora-quickcheck') as CalculatorTool;

  it('rates elite inputs as Elite', () => {
    const r = tool.compute({ deploysPerWeek: 14, leadTimeHours: 6, changeFailurePct: 3, mttrHours: 0.5 });
    expect(r.score).toBe(5);
    expect(r.headline).toContain('Elite');
    expect(r.metrics).toHaveLength(4);
  });

  it('rates poor inputs as Low and recommends fixes', () => {
    const r = tool.compute({ deploysPerWeek: 0.1, leadTimeHours: 1000, changeFailurePct: 45, mttrHours: 300 });
    expect(r.score).toBe(2);
    expect(r.headline).toContain('Low');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe('ai-cost-estimator', () => {
  const tool = getTool('ai-cost-estimator') as CalculatorTool;

  it('computes monthly cost and cache savings', () => {
    const r = tool.compute({ developers: 10, tasksPerWeek: 10, avgTokensPerTask: 40000, modelTier: 0, cacheHitPct: 30 });
    // 10*10*4.33 = 433 tasks; *40k = 17.32M tokens gross; *0.7 = 12.124M net; *$9/M ≈ $109
    expect(r.headline).toMatch(/^\$\d/);
    const cost = r.metrics.find((m) => m.label === 'Estimated monthly cost')!.value;
    expect(cost).toMatch(/^\$/);
    // Higher cache hit → lower cost.
    const cheaper = tool.compute({ developers: 10, tasksPerWeek: 10, avgTokensPerTask: 40000, modelTier: 0, cacheHitPct: 60 });
    const n = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
    expect(n(cheaper.metrics.find((m) => m.label === 'Estimated monthly cost')!.value))
      .toBeLessThan(n(r.metrics.find((m) => m.label === 'Estimated monthly cost')!.value));
  });

  it('budget tier costs less than frontier', () => {
    const front = tool.compute({ developers: 5, tasksPerWeek: 5, avgTokensPerTask: 30000, modelTier: 0, cacheHitPct: 0 });
    const budget = tool.compute({ developers: 5, tasksPerWeek: 5, avgTokensPerTask: 30000, modelTier: 2, cacheHitPct: 0 });
    const n = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
    expect(n(budget.headline)).toBeLessThan(n(front.headline));
  });
});

describe('tech-debt-estimator', () => {
  const tool = getTool('tech-debt-estimator') as CalculatorTool;
  it('computes annual debt cost and FTE-equivalent', () => {
    const r = tool.compute({ teamSize: 8, costPerDev: 150000, debtTimePct: 25, reworkPct: 15 });
    // payroll 1.2M; 40% lost → 480k.
    expect(r.headline).toContain('480,000');
    expect(r.metrics.find((m) => m.label === 'Capacity lost')!.value).toBe('40%');
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe('build-buy-agent', () => {
  const tool = getTool('build-buy-agent') as CalculatorTool;
  it('picks the cheapest 3-year option', () => {
    // Agent: 3*12*800 = 28.8k; Buy: 3*30k = 90k; Build: 6*13k=78k + 3*(20%*78k)=46.8k → 124.8k.
    const r = tool.compute({ devMonths: 6, devMonthlyCost: 13000, maintPctPerYear: 20, buyAnnualLicense: 30000, agentMonthlyCost: 800 });
    expect(r.headline).toContain('Agent');
    expect(r.metrics.find((m) => m.label === 'Cheapest')!.value).toBe('Agent');
  });
});

describe('questionnaire tools', () => {
  for (const id of ['cobit-governance', 'delivery-risk', 'agentic-maturity', 'incident-readiness', 'security-posture']) {
    const tool = getTool(id) as QuestionnaireTool;

    it(`${id}: all-5 answers score Optimizing with an empty plan`, () => {
      const answers: Record<string, number> = {};
      for (const s of tool.sections) for (const q of s.questions) answers[q.id] = 5;
      const r = tool.score(answers);
      expect(r.score).toBe(5);
      expect(r.scoreLabel).toBe('Optimizing');
      expect(r.recommendations).toHaveLength(0);
    });

    it(`${id}: low answers produce a prioritized plan (lowest first)`, () => {
      const answers: Record<string, number> = {};
      tool.sections.forEach((s, i) => s.questions.forEach((q) => { answers[q.id] = i === 0 ? 1 : 4; }));
      const r = tool.score(answers);
      expect(r.recommendations.length).toBeGreaterThan(0);
      // Lowest-scoring section (index 0) is targeted first.
      expect(r.recommendations[0]!.title).toContain(tool.sections[0]!.name);
    });
  }
});
