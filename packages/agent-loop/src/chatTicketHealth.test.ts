import { describe, it, expect } from 'vitest';
import { chatProgressIsStale, displayChatProgressPct, rollupChatTicketHealth } from './chatTicketHealth';

describe('rollupChatTicketHealth', () => {
  it('aggregates leaf ticket progressPct correctly (the VSIX bug)', () => {
    // The exact case from the bug report: 3 leaf tickets at 75/50/75
    // Expected: ~67% (weighted mean), NOT 0% (which the old Σdone/Σtotal gave)
    const tickets = [
      { id: '2394', title: 'Mobile board height', status: 'in_review', progressPct: 75, done: 0, total: 1 },
      { id: '2395', title: 'Deep-link bug', status: 'in_progress', progressPct: 50, done: 0, total: 1 },
      { id: '2396', title: 'Code delta', status: 'in_review', progressPct: 75, done: 0, total: 1 },
    ];

    const result = rollupChatTicketHealth(tickets);

    // Weighted mean: (75+50+75)/3 = 66.666... → 67%
    expect(result.pct).toBe(67);
    expect(result.done).toBe(0); // items counter unchanged
    expect(result.total).toBe(3);
  });

  it('weights containers by their total (sub-items)', () => {
    // Container with 4 sub-items at 50% should outweigh 2 leaf tickets at 100%
    const tickets = [
      { id: '1', title: 'Container', status: 'in_progress', progressPct: 50, done: 2, total: 4 },
      { id: '2', title: 'Leaf A', status: 'done', progressPct: 100, done: 1, total: 1 },
      { id: '3', title: 'Leaf B', done: 1, total: 1, progressPct: 100 },
    ];

    const result = rollupChatTicketHealth(tickets);

    // Weighted: (50*4 + 100*1 + 100*1) / (4+1+1) = (200+100+100)/6 = 400/6 = 66.67 → 67%
    expect(result.pct).toBe(67);
    expect(result.done).toBe(4); // 2+1+1
    expect(result.total).toBe(6); // 4+1+1
  });

  it('falls back to unweighted mean when no ticket has sub-items', () => {
    const tickets = [
      { id: '1', title: 'Task', progressPct: 50, done: 0, total: 1 },
      { id: '2', title: 'Task', progressPct: 100, done: 1, total: 1 },
    ];

    const result = rollupChatTicketHealth(tickets);

    // Unweighted mean: (50+100)/2 = 75%
    expect(result.pct).toBe(75);
  });

  it('counts a 0-total ticket as weight 1 so 0% rings pull the headline down', () => {
    // Screenshot: 4 done leaves + incomplete spec (total:0) + incomplete roadmap (total:0).
    // Old weighting dropped the two 0% chips → 100% · 4/4. They must count.
    const tickets = [
      { progressPct: 100, done: 1, total: 1 },
      { progressPct: 100, done: 1, total: 1 },
      { progressPct: 0, done: 0, total: 0 },
      { progressPct: 100, done: 1, total: 1 },
      { progressPct: 0, done: 0, total: 0 },
      { progressPct: 100, done: 1, total: 1 },
    ];

    const result = rollupChatTicketHealth(tickets);

    // (100×4 + 0×1 + 0×1) / 6 = 400/6 → 67%
    expect(result.pct).toBe(67);
    expect(result.done).toBe(4);
    expect(result.total).toBe(6);
  });

  it('returns 0% for empty ticket list', () => {
    const result = rollupChatTicketHealth([]);
    expect(result.pct).toBe(0);
    expect(result.done).toBe(0);
    expect(result.total).toBe(0);
  });

  it('excludes cancelled so 3 done + 1 cancelled is 100% (VSIX header bug)', () => {
    // Screenshot: 3×100% done + 1×0% cancelled → header read 75% · 3/4.
    const result = rollupChatTicketHealth([
      { progressPct: 100, done: 1, total: 1, status: 'done' },
      { progressPct: 100, done: 1, total: 1, status: 'done' },
      { progressPct: 100, done: 1, total: 1, status: 'done' },
      { progressPct: 0, done: 0, total: 1, status: 'cancelled' },
    ]);
    expect(result).toEqual({ pct: 100, done: 3, total: 3 });
  });

  it('treats an all-cancelled list as 100% (nothing left owed)', () => {
    expect(rollupChatTicketHealth([
      { progressPct: 0, done: 0, total: 1, status: 'cancelled' },
    ])).toEqual({ pct: 100, done: 0, total: 0 });
  });

  it('accepts US spelling canceled', () => {
    expect(rollupChatTicketHealth([
      { progressPct: 50, done: 0, total: 1, status: 'in_progress' },
      { progressPct: 0, done: 0, total: 1, status: 'canceled' },
    ])).toEqual({ pct: 50, done: 0, total: 1 });
  });
});

/** The tree used to floor what the picker and the rail rounded — one point apart. */
describe('displayChatProgressPct', () => {
  it('rounds, clamps, and declines what it cannot show', () => {
    expect(displayChatProgressPct(59.6)).toBe(60);
    expect(displayChatProgressPct(99.9)).toBe(100);
    expect(displayChatProgressPct(-3)).toBe(0);
    expect(displayChatProgressPct(140)).toBe(100);
    expect(displayChatProgressPct(null)).toBeNull();
    expect(displayChatProgressPct(Number.NaN)).toBeNull();
    expect(displayChatProgressPct('60')).toBeNull();
  });
});

/** The picker/tree snapshot against the rail's live tickets (23% vs 60% vs 18%). */
describe('chatProgressIsStale', () => {
  const live = [
    { progressPct: 100, done: 1, total: 1 },
    { progressPct: 50, done: 0, total: 1, status: 'in_progress' },
  ];

  it('flags a row whose percent no longer matches the live tickets', () => {
    expect(chatProgressIsStale({ ticketCount: 2, ticketProgressPct: 18 }, live)).toBe(true);
  });

  it('flags a row whose ticket count is behind', () => {
    expect(chatProgressIsStale({ ticketCount: 1, ticketProgressPct: 75 }, live)).toBe(true);
  });

  it('accepts a row that agrees, rounding included', () => {
    expect(chatProgressIsStale({ ticketCount: 2, ticketProgressPct: 75.2 }, live)).toBe(false);
  });

  it('never flags a row that carries no summary, or a missing row', () => {
    expect(chatProgressIsStale({}, live)).toBe(false);
    expect(chatProgressIsStale(undefined, live)).toBe(false);
  });
});
