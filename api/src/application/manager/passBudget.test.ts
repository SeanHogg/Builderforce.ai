import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPassBudget, MANAGER_PASS_BUDGET_MS } from './ManagerService';

/**
 * THE EVICTION. A manager pass runs inside ONE Worker invocation. On project 11 (673
 * tickets, 354 open PRs) it was dying partway through the PR/merge loop: `manager_actions`
 * showed triage journalling every few minutes, while the `manager.pass` activity row that
 * CLOSES a pass had not been written since 2026-07-13 and `lastRunAt` sat 6 hours stale
 * against a 5-minute cadence.
 *
 * The lost work was the smaller half of the problem. The larger half: nothing recorded
 * that the pass had been cut short, so a truncated pass and a clean one were
 * indistinguishable — the manager reported health it had never verified.
 */
afterEach(() => { vi.useRealTimers(); });

describe('createPassBudget', () => {
  it('is under budget at the start and over it once the window elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
    const budget = createPassBudget(Date.now(), 20_000);
    expect(budget.over()).toBe(false);
    vi.advanceTimersByTime(19_999);
    expect(budget.over()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(budget.over()).toBe(true);
  });

  it('reports elapsed wall-clock so the closing row can state WHERE the time went', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
    const budget = createPassBudget(Date.now(), 20_000);
    vi.advanceTimersByTime(7_500);
    expect(budget.elapsedMs()).toBe(7_500);
  });

  it('records each shed stage ONCE, in order — the loop calls it per iteration', () => {
    const budget = createPassBudget(Date.now(), 20_000);
    expect(budget.shed('pr_conduct')).toBe(true);
    expect(budget.shed('pr_conduct')).toBe(false);
    expect(budget.shed('pr_merge')).toBe(true);
    expect(budget.shed('triage')).toBe(true);
    expect(budget.truncated).toEqual(['pr_conduct', 'pr_merge', 'triage']);
  });

  it('starts with nothing truncated, so a complete pass reports an empty list', () => {
    expect(createPassBudget(Date.now()).truncated).toEqual([]);
  });

  it('leaves headroom for the closing journal rather than running to the Worker ceiling', () => {
    // The budget exists to GUARANTEE the pass reaches `manager.pass`. A value at or above
    // the invocation ceiling would defeat the entire mechanism.
    expect(MANAGER_PASS_BUDGET_MS).toBeGreaterThan(5_000);
    expect(MANAGER_PASS_BUDGET_MS).toBeLessThan(30_000);
  });
});
