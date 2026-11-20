import { describe, it, expect } from 'vitest';
import {
  CLAIMED_COMPLETE_PROGRESS_CAP,
  chatProgressIsStale,
  closedLaneProgress,
  displayChatProgressPct,
  effectiveTicketProgress,
  rollupChatTicketHealth,
} from './chatTicketHealth';

/**
 * The ONE task-tier rule the server (status ladder + epic branch) and the rail delegate
 * to: only a closed lane emits 100, and a closed lane always does.
 */
describe('effectiveTicketProgress', () => {
  it("a done lane floors to 100, so a stale record percent can't demote it", () => {
    // The UI/UX bug: chip badge reads DONE while the ring shows 75 — a stale
    // progressPct from an earlier open-lane snapshot won over the done lane.
    expect(effectiveTicketProgress('done', 75)).toBe(100);
    expect(effectiveTicketProgress('done', 0)).toBe(100);
    expect(effectiveTicketProgress('done', 100)).toBe(100);
  });

  it('a closed lane is not demoted by the claimed-complete cap', () => {
    expect(effectiveTicketProgress('done', 100)).toBe(100);
    expect(effectiveTicketProgress('done', 75)).toBe(100);
  });

  it('regression: a closed lane is complete on the server too — the rail and the panel agree', () => {
    // The server used to pass a closed lane's raw percent through (an epic closed with
    // 3 of 5 children done read 60) while the rail floored it to 100.
    expect(effectiveTicketProgress('done', 60)).toBe(100);
    expect(effectiveTicketProgress('cancelled', 0)).toBe(100);
  });

  it('caps a claimed-complete OPEN ticket at the claimed-complete rung', () => {
    expect(effectiveTicketProgress('in_review', 100)).toBe(75);
    expect(effectiveTicketProgress('in_review', 80)).toBe(80); // never raises a lower figure
  });

  it('regression: chat #276 — an open epic whose filed children are all done reads 75, not 100', () => {
    // Epic "Measure PRD" sat in_progress with two done children (raw 2/2 = 100): the
    // ring read "done" while the lane said open and unfiled slices remained.
    expect(effectiveTicketProgress('in_progress', 100)).toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
    const epic = { status: 'in_progress', progressPct: effectiveTicketProgress('in_progress', 100), done: 2, total: 2 };
    expect(rollupChatTicketHealth([epic])).toMatchObject({ pct: 75, completedTickets: 0, openTickets: 1 });
    // Closing the lane is what emits the completion signal.
    expect(effectiveTicketProgress('done', 100)).toBe(100);
  });

  it('closedLaneProgress (any tier) floors a closed lane and never caps an open one', () => {
    // Other tiers speak their own vocabulary ("complete", "shipped"), so the rollup must
    // not cap their 100.
    expect(closedLaneProgress('shipped', 100)).toBe(100);
    expect(closedLaneProgress('complete', 100)).toBe(100);
    expect(closedLaneProgress('done', 75)).toBe(100);
    expect(closedLaneProgress('in_progress', 40)).toBe(40);
  });

  it('treats a missing / blank status as open (only a closed lane wins)', () => {
    expect(effectiveTicketProgress(undefined, 75)).toBe(75);
    expect(effectiveTicketProgress(null, 75)).toBe(75);
    expect(effectiveTicketProgress('', 75)).toBe(75);
    expect(effectiveTicketProgress('in_progress', 50)).toBe(50);
  });
});

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
    expect(result).toEqual({ pct: 100, done: 3, total: 3, openTickets: 0, completedTickets: 3 });
  });

  it('treats an all-cancelled list as 100% (nothing left owed)', () => {
    expect(rollupChatTicketHealth([
      { progressPct: 0, done: 0, total: 1, status: 'cancelled' },
    ])).toEqual({ pct: 100, done: 0, total: 0, openTickets: 0, completedTickets: 0 });
  });

  it('excludes a deleted ticket (exists: false) so 6 done + 1 deleted is 100% · 6/6', () => {
    // The screenshot bug: a chat with 6 done tickets and one whose platform row was
    // DELETED read 86% · 6/7. The server reports the deleted link as the '(deleted)'
    // placeholder (status 'unknown', progressPct 0); that is removed work, not open
    // work, so the rollup must skip it exactly like a cancelled lane.
    const result = rollupChatTicketHealth([
      { progressPct: 100, done: 1, total: 1, status: 'done', exists: true },
      { progressPct: 100, done: 1, total: 1, status: 'done', exists: true },
      { progressPct: 100, done: 1, total: 1, status: 'done', exists: true },
      { progressPct: 100, done: 1, total: 1, status: 'done', exists: true },
      { progressPct: 100, done: 1, total: 1, status: 'done', exists: true },
      { progressPct: 100, done: 1, total: 1, status: 'done', exists: true },
      // The '(deleted)' placeholder a health miss produces:
      { progressPct: 0, done: 0, total: 0, status: 'unknown', exists: false },
    ]);
    expect(result).toEqual({ pct: 100, done: 6, total: 6, openTickets: 0, completedTickets: 6 });
  });

  it('treats an all-deleted list as 100% (nothing left owed), like all-cancelled', () => {
    expect(rollupChatTicketHealth([
      { progressPct: 0, done: 0, total: 0, status: 'unknown', exists: false },
    ])).toEqual({ pct: 100, done: 0, total: 0, openTickets: 0, completedTickets: 0 });
  });

  it('accepts US spelling canceled', () => {
    expect(rollupChatTicketHealth([
      { progressPct: 50, done: 0, total: 1, status: 'in_progress' },
      { progressPct: 0, done: 0, total: 1, status: 'canceled' },
    ])).toEqual({ pct: 50, done: 0, total: 1, openTickets: 1, completedTickets: 0 });
  });

  it('does not let a pre-close 100 pull the session to complete', () => {
    // Chat #112: the epic chip said 100 while the spec, roadmap and gaps were still
    // open. The producer's cap keeps the mean honest — but only BEFORE the lane closes
    // (see the next test).
    const result = rollupChatTicketHealth([
      { progressPct: effectiveTicketProgress('in_review', 100), done: 1, total: 1, status: 'in_review' },
      { progressPct: 0, done: 0, total: 1, status: 'draft' },
      { progressPct: 0, done: 0, total: 1, status: 'planned' },
    ]);
    expect(result.pct).toBeLessThan(100);
    expect(result.pct).toBe(25);
  });

  it('a done lane is complete even without delivery evidence (the #6618 bug)', () => {
    // #6618 sat in the done lane but the chip read 75%: a pre-close cap demoted it.
    // The status ladder is authoritative once closed — a done ticket must read 100
    // and count as completed.
    const result = rollupChatTicketHealth([
      { progressPct: effectiveTicketProgress('done', 100), done: 1, total: 1, status: 'done' },
    ]);
    expect(result.pct).toBe(100);
    expect(result.completedTickets).toBe(1);
    expect(result.openTickets).toBe(0);
  });
});

/** The history row's "N open · M done" line: tickets, not sub-items. */
describe('rollupChatTicketHealth open / completed tickets', () => {
  it('splits a mixed list into open and completed tickets', () => {
    const result = rollupChatTicketHealth([
      { progressPct: 100, done: 1, total: 1, status: 'done' },
      { progressPct: 100, done: 4, total: 4, status: 'done' },
      { progressPct: 75, done: 0, total: 1, status: 'in_review' },
      { progressPct: 0, done: 0, total: 0 },
    ]);
    expect(result.completedTickets).toBe(2);
    expect(result.openTickets).toBe(2);
  });

  it('counts a cancelled ticket as neither open nor completed', () => {
    const result = rollupChatTicketHealth([
      { progressPct: 100, done: 1, total: 1, status: 'done' },
      { progressPct: 20, done: 0, total: 1, status: 'in_progress' },
      { progressPct: 100, done: 0, total: 1, status: 'cancelled' },
      { progressPct: 0, done: 0, total: 1, status: 'canceled' },
    ]);
    expect(result.completedTickets).toBe(1);
    expect(result.openTickets).toBe(1);
  });

  it('keeps a claimed-complete 100 open only before the lane closes', () => {
    // A pre-close claim stays capped (counts open)…
    expect(rollupChatTicketHealth([
      { progressPct: effectiveTicketProgress('in_review', 100), done: 1, total: 1, status: 'in_review' },
      { progressPct: 100, done: 1, total: 1, status: 'done' },
    ])).toMatchObject({ completedTickets: 1, openTickets: 1 });
    // …but the same ticket in a closed lane is complete.
    expect(rollupChatTicketHealth([
      { progressPct: effectiveTicketProgress('done', 100), done: 1, total: 1, status: 'done' },
      { progressPct: 100, done: 1, total: 1, status: 'done' },
    ])).toMatchObject({ completedTickets: 2, openTickets: 0 });
  });

  it('reports 0 / 0 for an empty list', () => {
    const result = rollupChatTicketHealth([]);
    expect(result.openTickets).toBe(0);
    expect(result.completedTickets).toBe(0);
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
