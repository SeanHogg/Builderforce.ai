import { describe, it, expect } from 'vitest';
import { rankBacklog, scoreTask, urgencyScore, NEUTRAL_BUSINESS_VALUE, type RankableTask } from './prioritize';

const NOW = Date.parse('2026-07-03T00:00:00Z');
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * 86_400_000).toISOString();

const task = (over: Partial<RankableTask> & { taskId: number }): RankableTask => ({
  priority: 'medium',
  businessValue: null,
  dueDate: null,
  status: 'todo',
  createdAt: iso(-1),
  ...over,
});

describe('urgencyScore', () => {
  it('is 0 for undated or far-out tickets', () => {
    expect(urgencyScore(null, NOW)).toBe(0);
    expect(urgencyScore(iso(30), NOW)).toBe(0);
  });
  it('saturates at/above 100 when overdue', () => {
    expect(urgencyScore(iso(-1), NOW)).toBeGreaterThanOrEqual(100);
    expect(urgencyScore(iso(-100), NOW)).toBeLessThanOrEqual(120);
  });
  it('ramps up as the due date nears', () => {
    expect(urgencyScore(iso(1), NOW)).toBeGreaterThan(urgencyScore(iso(10), NOW));
  });
});

describe('scoreTask', () => {
  it('treats an unscored ticket as the neutral midpoint', () => {
    const s = scoreTask(task({ taskId: 1, businessValue: null }), NOW);
    expect(s.value).toBe(NEUTRAL_BUSINESS_VALUE);
  });
  it('ranks urgent above low priority, all else equal', () => {
    const hi = scoreTask(task({ taskId: 1, priority: 'urgent' }), NOW).score;
    const lo = scoreTask(task({ taskId: 2, priority: 'low' }), NOW).score;
    expect(hi).toBeGreaterThan(lo);
  });
  it('gives in-progress work a finish-it bonus over identical todo work', () => {
    const running = scoreTask(task({ taskId: 1, status: 'in_progress' }), NOW).score;
    const todo = scoreTask(task({ taskId: 2, status: 'todo' }), NOW).score;
    expect(running).toBeGreaterThan(todo);
  });
});

describe('rankBacklog', () => {
  it('assigns dense 1..N ranks, highest score first', () => {
    const ranked = rankBacklog([
      task({ taskId: 1, priority: 'low' }),
      task({ taskId: 2, priority: 'urgent', businessValue: 90 }),
      task({ taskId: 3, priority: 'medium' }),
    ], NOW);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0]!.taskId).toBe(2); // urgent + high value wins
  });
  it('breaks ties by earliest creation then id (deterministic)', () => {
    const ranked = rankBacklog([
      task({ taskId: 5, createdAt: iso(-1) }),
      task({ taskId: 4, createdAt: iso(-3) }),
    ], NOW);
    expect(ranked[0]!.taskId).toBe(4); // older first when scores tie
  });
  it('floats a high-value urgent ticket to rank 1 over an old low-priority one', () => {
    const ranked = rankBacklog([
      task({ taskId: 1, priority: 'low', createdAt: iso(-40) }),
      task({ taskId: 2, priority: 'urgent', businessValue: 95, dueDate: iso(1) }),
    ], NOW);
    expect(ranked[0]!.taskId).toBe(2);
  });
});
