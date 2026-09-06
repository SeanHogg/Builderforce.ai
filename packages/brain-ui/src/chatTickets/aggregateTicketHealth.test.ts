import { describe, it, expect } from 'vitest';
import { aggregateTicketHealth } from './aggregateTicketHealth';
import type { ChatTicketNode } from './types';

describe('aggregateTicketHealth', () => {
  it('aggregates leaf ticket progressPct correctly (the VSIX bug)', () => {
    // The exact case from the bug report: 3 leaf tickets at 75/50/75
    // Expected: ~67% (weighted mean), NOT 0% (which the old Σdone/Σtotal gave)
    const tickets: ChatTicketNode[] = [
      { id: '2394', title: 'Mobile board height', status: 'in_review', progressPct: 75, done: 0, total: 1 },
      { id: '2395', title: 'Deep-link bug', status: 'in_progress', progressPct: 50, done: 0, total: 1 },
      { id: '2396', title: 'Code delta', status: 'in_review', progressPct: 75, done: 0, total: 1 },
    ];

    const result = aggregateTicketHealth(tickets);

    // Weighted mean: (75+50+75)/3 = 66.666... → 67%
    expect(result.pct).toBe(67);
    expect(result.done).toBe(0); // items counter unchanged
    expect(result.total).toBe(3);
  });

  it('weights containers by their total (sub-items)', () => {
    // Container with 4 sub-items at 50% should outweigh 2 leaf tickets at 100%
    const tickets: ChatTicketNode[] = [
      { id: '1', title: 'Container', status: 'in_progress', progressPct: 50, done: 2, total: 4 },
      { id: '2', title: 'Leaf A', status: 'done', progressPct: 100, done: 1, total: 1 },
      { id: '3', title: 'Leaf B', done: 1, total: 1, progressPct: 100 },
    ];

    const result = aggregateTicketHealth(tickets);

    // Weighted: (50*4 + 100*1 + 100*1) / (4+1+1) = (200+100+100)/6 = 400/6 = 66.67 → 67%
    expect(result.pct).toBe(67);
    expect(result.done).toBe(4); // 2+1+1
    expect(result.total).toBe(6); // 4+1+1
  });

  it('falls back to unweighted mean when no ticket has sub-items', () => {
    const tickets: ChatTicketNode[] = [
      { id: '1', title: 'Task', progressPct: 50, done: 0, total: 1 },
      { id: '2', title: 'Task', progressPct: 100, done: 1, total: 1 },
    ];

    const result = aggregateTicketHealth(tickets);

    // Unweighted mean: (50+100)/2 = 75%
    expect(result.pct).toBe(75);
  });

  it('returns 0% for empty ticket list', () => {
    const result = aggregateTicketHealth([]);
    expect(result.pct).toBe(0);
    expect(result.done).toBe(0);
    expect(result.total).toBe(0);
  });
});
