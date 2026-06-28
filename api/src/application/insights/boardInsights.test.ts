import { describe, it, expect } from 'vitest';
import { summarizeQuality } from './qualityInsights';
import { summarizePeople } from './peopleInsights';
import { summarizeRdFinancials } from './rdFinancialsInsights';

const now = Date.parse('2026-06-27T00:00:00.000Z');
const daysAgo = (n: number) => new Date(now - n * 86_400_000);

describe('summarizeQuality', () => {
  it('computes MTTR, alerts, support per-customer and defect aging', () => {
    const incidents = [
      { isAlertOnly: false, startedAt: daysAgo(3), resolvedAt: daysAgo(3 - 0.25) }, // 6h MTTR
      { isAlertOnly: false, startedAt: daysAgo(2), resolvedAt: null },               // unresolved
      { isAlertOnly: true, startedAt: daysAgo(1), resolvedAt: null },                // alert only
    ];
    const tickets = [
      { isBug: true, customerRef: 'c1', openedAt: daysAgo(5) },
      { isBug: false, customerRef: 'c1', openedAt: daysAgo(4) },
      { isBug: false, customerRef: 'c2', openedAt: daysAgo(2) },
    ];
    const defects = [
      { status: 'open', createdAt: daysAgo(2) },     // 0-7d
      { status: 'triaged', createdAt: daysAgo(40) },  // 31-90d
      { status: 'resolved', createdAt: daysAgo(1) },  // excluded (not open)
    ];
    const q = summarizeQuality(incidents, tickets, [], defects, 90, now);
    expect(q.alertsCount).toBe(1);
    expect(q.prodIncidents.count).toBe(2);
    expect(q.prodIncidents.mttrHours).toBeCloseTo(6, 5);
    expect(q.support.tickets).toBe(3);
    expect(q.support.bugs).toBe(1);
    expect(q.support.distinctCustomers).toBe(2);
    expect(q.support.perCustomer).toBeCloseTo(1.5, 5);
    expect(q.defectAging.find((b) => b.bucket === '0-7d')!.count).toBe(1);
    expect(q.defectAging.find((b) => b.bucket === '31-90d')!.count).toBe(1);
  });
});

describe('summarizePeople', () => {
  it('builds a headcount waterfall and attrition rate', () => {
    const events = [
      { eventType: 'hire', effectiveOn: '2026-01-15', isVoluntary: null },
      { eventType: 'hire', effectiveOn: '2026-02-10', isVoluntary: null },
      { eventType: 'leave', effectiveOn: '2026-03-05', isVoluntary: true },
    ];
    const p = summarizePeople(events, [], [], 6, now, { score: 80, enps: 20, responses: 10 });
    const last = p.waterfall[p.waterfall.length - 1]!;
    expect(last.endHeadcount).toBe(1); // 2 hires - 1 leave
    expect(p.attritionRatePct).not.toBeNull();
    expect(p.devSatisfaction.score).toBe(80);
  });

  it('surfaces ramping members and open positions', () => {
    const p = summarizePeople(
      [],
      [{ reqTitle: 'UX Lead', priority: 'high', status: 'open', openedOn: '2026-05-22', targetStartOn: '2026-07-01' }],
      [{ memberRef: 'u1', rampFactor: 0.5 }],
      6, now, { score: null, enps: 0, responses: 0 },
    );
    expect(p.rampingMembers).toHaveLength(1);
    expect(p.rampingMembers[0]!.rampPct).toBe(50);
    expect(p.openPositions[0]!.reqTitle).toBe('UX Lead');
    expect(p.openPositions[0]!.daysOpen).toBeGreaterThan(0);
  });
});

describe('summarizeRdFinancials', () => {
  it('computes actual-vs-plan, QoQ growth and R&D/revenue', () => {
    const financials = [
      { quarter: 1, category: 'headcount', actualUsd: 100, planUsd: 120 },
      { quarter: 2, category: 'headcount', actualUsd: 150, planUsd: 150 },
    ];
    const revenue = [{ quarter: 2, revenueUsd: 1000 }];
    const fte = [{ quarter: 2, category: 'growth', fte: 4 }];
    const r = summarizeRdFinancials(2026, financials, revenue, fte);
    const q2 = r.quarters.find((q) => q.quarter === 2)!;
    expect(q2.totalActualUsd).toBe(150);
    expect(q2.byCategory[0]!.actualVsPlanPct).toBe(100);
    expect(q2.growthVsPriorQPct).toBeCloseTo(50, 5); // 100 → 150
    expect(q2.rdToRevenuePct).toBeCloseTo(15, 5);     // 150 / 1000
    expect(q2.fteByCategory[0]!.fte).toBe(4);
  });
});
