import { describe, it, expect } from 'vitest';
import {
  createTickDispatchBudget,
  MAX_TENANT_DISPATCHES_PER_TICK,
} from './tickDispatchBudget';

describe('tickDispatchBudget', () => {
  it('grants up to the limit for a tenant, then refuses', () => {
    const budget = createTickDispatchBudget(3);
    expect(budget.tryReserve(1)).toBe(true);
    expect(budget.tryReserve(1)).toBe(true);
    expect(budget.tryReserve(1)).toBe(true);
    expect(budget.tryReserve(1)).toBe(false);
    expect(budget.reserved(1)).toBe(3);
  });

  it('budgets each tenant independently', () => {
    const budget = createTickDispatchBudget(2);
    budget.tryReserve(1);
    budget.tryReserve(1);
    // Tenant 1 is exhausted; tenant 2 must be untouched by that.
    expect(budget.tryReserve(1)).toBe(false);
    expect(budget.tryReserve(2)).toBe(true);
    expect(budget.reserved(2)).toBe(1);
  });

  it('hasRoom reports without consuming a slot', () => {
    const budget = createTickDispatchBudget(1);
    expect(budget.hasRoom(7)).toBe(true);
    expect(budget.hasRoom(7)).toBe(true);
    expect(budget.reserved(7)).toBe(0);
    budget.tryReserve(7);
    expect(budget.hasRoom(7)).toBe(false);
  });

  /**
   * The whole point of the shared budget: two sweeps in one tick draw from ONE
   * tenant ceiling. Before this, each sweep held a private counter, so a tenant
   * could take the full allowance from the autonomous executor AND again from the
   * manager pass inside the same five-minute window.
   */
  it('shares one ceiling across sweeps in the same tick', () => {
    const budget = createTickDispatchBudget(5);
    // Sweep A (autonomous executor) spends 4.
    for (let i = 0; i < 4; i++) expect(budget.tryReserve(42)).toBe(true);
    // Sweep B (manager pass) sees the spend and gets only the remaining 1.
    expect(budget.hasRoom(42)).toBe(true);
    expect(budget.tryReserve(42)).toBe(true);
    expect(budget.hasRoom(42)).toBe(false);
    expect(budget.tryReserve(42)).toBe(false);
    expect(budget.reserved(42)).toBe(5);
  });

  it('totals spend across every tenant for the cron log line', () => {
    const budget = createTickDispatchBudget(10);
    budget.tryReserve(1);
    budget.tryReserve(2);
    budget.tryReserve(2);
    expect(budget.total()).toBe(3);
  });

  it('an unspent budget reports zero rather than undefined', () => {
    const budget = createTickDispatchBudget();
    expect(budget.reserved(999)).toBe(0);
    expect(budget.total()).toBe(0);
    expect(budget.hasRoom(999)).toBe(true);
  });

  it('defaults to the documented shared ceiling', () => {
    const budget = createTickDispatchBudget();
    for (let i = 0; i < MAX_TENANT_DISPATCHES_PER_TICK; i++) {
      expect(budget.tryReserve(1)).toBe(true);
    }
    expect(budget.tryReserve(1)).toBe(false);
  });
});
