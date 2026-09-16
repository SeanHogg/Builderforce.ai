import { describe, it, expect } from 'vitest';
import {
  formatStaffingSummary,
  staffingSummaryInTrace,
  workFiledNotStaffedVerdict,
} from './staffingSummary';
import type { BrainTraceEvent } from './brainTriage';

/** A settled tool step. `result` defaults to a plain success so a caller only states
 *  the thing the case is actually about. */
function tool(label: string, result: unknown = { ok: true }, isError = false): BrainTraceEvent {
  return { ts: '2026-09-15T10:00:00.000Z', category: 'tool', label, result, isError };
}

/** The refusal chat #113 actually got, five times over. */
const MANAGER_403 = { ok: false, error: 'manager role required' };

describe('staffingSummaryInTrace', () => {
  it('a run that files work and asks nobody is filed-not-staffed', () => {
    const events = [
      tool('builtin_tasks_create', { ok: true, id: 1 }),
      tool('builtin_tasks_create', { ok: true, id: 2 }),
      tool('builtin_projects_get', { ok: true }),
    ];
    const s = staffingSummaryInTrace(events);
    expect(s.ticketsCreated).toBe(2);
    expect(s.dispatchAttempts).toBe(0);
    expect(s.dispatched).toBe(0);
    expect(s.verdict).toBe('filed-not-staffed');
    // The whole point: the line must SAY it, not leave it to be inferred from two zeroes.
    expect(formatStaffingSummary(s).join('\n')).toMatch(/nobody is running it/i);
  });

  it('chat #113: twelve tickets, every coordination call refused 403', () => {
    const events = [
      ...Array.from({ length: 12 }, (_, i) => tool('builtin_tasks_create', { ok: true, id: i + 1 })),
      tool('builtin_kanban_coordinate', MANAGER_403, true),
      tool('builtin_kanban_coordinate', MANAGER_403, true),
      tool('builtin_kanban_materialize_work_items', MANAGER_403, true),
      tool('builtin_kanban_assess_resource', MANAGER_403, true),
      tool('builtin_kanban_assign_participant', MANAGER_403, true),
    ];
    const s = staffingSummaryInTrace(events);
    expect(s.ticketsCreated).toBe(12);
    expect(s.dispatchAttempts).toBe(5);
    expect(s.dispatched).toBe(0);
    expect(s.dispatchRefusals).toHaveLength(5);
    expect(s.dispatchRefusals[0].message).toBe('manager role required');
    expect(s.verdict).toBe('staffing-refused');
    // Five identical refusals are ONE fact — grouped with a count, not printed five times.
    const verdict = workFiledNotStaffedVerdict(s);
    expect(verdict).toContain('12 ticket(s) created, 0 dispatched');
    expect(verdict).toContain('manager role required ×5');
    expect(verdict).toContain('Nobody is running the work.');
  });

  it('a successful dispatch is staffed', () => {
    const events = [
      tool('builtin_tasks_create', { ok: true, id: 1 }),
      tool('builtin_chats_dispatch_agent', { ok: true, executionId: 9 }),
    ];
    const s = staffingSummaryInTrace(events);
    expect(s.dispatched).toBe(1);
    expect(s.verdict).toBe('staffed');
  });

  it('a 200 that dispatched NOBODY is a refusal, not a success', () => {
    // `autoRun.dispatched:false` is the platform saying "nothing started" in the same
    // breath as an ok result — the case a plain error check reports as staffed.
    const events = [
      tool('builtin_tasks_create', { ok: true, id: 1 }),
      tool('builtin_kanban_coordinate', { ok: true, autoRun: { dispatched: false, detail: 'no capable agent on the project' } }),
    ];
    const s = staffingSummaryInTrace(events);
    expect(s.dispatchAttempts).toBe(1);
    expect(s.dispatched).toBe(0);
    expect(s.dispatchRefusals[0].message).toBe('no capable agent on the project');
    expect(s.verdict).toBe('staffing-refused');
  });

  it('work done HERE in a team agent\'s persona counts as staffed', () => {
    const events: BrainTraceEvent[] = [
      tool('builtin_tasks_create', { ok: true, id: 1 }),
      {
        ts: '2026-09-15T10:01:00.000Z',
        category: 'tool',
        label: 'spawn_agent',
        args: { as_agent: 'Ada', label: 'port the auth middleware' },
        result: JSON.stringify({ ok: true, label: 'as Ada: port the auth middleware' }),
      },
    ];
    const s = staffingSummaryInTrace(events);
    expect(s.personaSubagents).toEqual([{ agent: 'Ada', label: 'port the auth middleware', ok: true }]);
    expect(s.verdict).toBe('staffed');
    expect(formatStaffingSummary(s).join('\n')).toContain('Ada — port the auth middleware');
  });

  it('ignores a delegation that named no persona', () => {
    const events: BrainTraceEvent[] = [
      { ts: '2026-09-15T10:01:00.000Z', category: 'tool', label: 'spawn_agent', args: { task: 'find the middleware' }, result: { ok: true } },
    ];
    expect(staffingSummaryInTrace(events).personaSubagents).toEqual([]);
  });

  it('a plain question files nothing and staffs nobody — and says nothing about it', () => {
    const events = [tool('builtin_projects_list', { ok: true, projects: [] })];
    const s = staffingSummaryInTrace(events);
    expect(s.verdict).toBe('no-work-filed');
    // A conversational run must not grow a staffing paragraph it has no use for.
    expect(formatStaffingSummary(s)).toEqual([]);
  });
});
