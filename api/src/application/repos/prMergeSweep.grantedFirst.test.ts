/**
 * PRD 48 §4.6 — the sweep runs the GRANTED cohort first, inside the sweep's own budget, before it
 * selects a single managed project; and the managed queue is reached exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  order: [] as string[],
  granted: vi.fn(async (..._a: unknown[]) => ({ considered: 1, merged: 1, held: 0, voided: 0 })),
}));

vi.mock('./grantedMergeCohort', () => ({
  runGrantedMerges: vi.fn(async (...a: unknown[]) => { h.order.push('granted'); return h.granted(...a); }),
}));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({}) }));
vi.mock('../../infrastructure/database/connection', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildDatabase: () => {
    // The managed project selection: record WHEN it reads, answer "no projects".
    const chain: Record<string, unknown> = {};
    const pass = () => chain;
    chain.from = pass; chain.innerJoin = pass; chain.where = pass; chain.groupBy = pass; chain.orderBy = pass;
    chain.limit = async () => { h.order.push('managed-projects'); return []; };
    return { select: () => chain };
  },
}));

import { runPrMergeSweep } from './prMergeSweep';
import { createTickDispatchBudget } from '../runtime/tickDispatchBudget';

beforeEach(() => { h.order = []; h.granted.mockClear(); });

describe('runPrMergeSweep — the granted cohort first', () => {
  it('runs the granted cohort BEFORE selecting managed projects, and counts its merges', async () => {
    const out = await runPrMergeSweep({} as never, createTickDispatchBudget());
    expect(h.order).toEqual(['granted', 'managed-projects']);
    expect(out.merged).toBe(1);
    expect(out.grantedMerged).toBe(1);
  });

  it('hands the cohort the sweep\'s budget (a wall clock that is already running), not one of its own', async () => {
    await runPrMergeSweep({} as never, createTickDispatchBudget());
    const budget = h.granted.mock.calls[0]![2] as { over(): boolean; canAfford(ms: number): boolean };
    expect(typeof budget.over).toBe('function');
    expect(budget.over()).toBe(false);
  });
});
