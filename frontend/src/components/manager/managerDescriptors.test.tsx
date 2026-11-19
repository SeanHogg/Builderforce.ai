import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ManagerAction, ManagerBacklogItem, ManagerRunTask, StallWatchRow } from '@/lib/builderforceApi';
import {
  managerActivityDescriptor, managerBacklogDescriptor, managerRunTasksDescriptor, managerStallsDescriptor, runTaskStatusKey,
} from './managerDescriptors';

const asRow = <T,>(o: unknown) => o as T;

describe('managerBacklogDescriptor', () => {
  const d = managerBacklogDescriptor({
    rank: 'Rank', key: 'Key', title: 'Title', priority: 'Priority', businessValue: 'BV', dueDate: 'Due', assignee: 'Owner',
    unassigned: 'Unassigned', noRationale: 'none', priorityLabel: (p) => String(p), owner: () => 'Ann', due: (s) => s,
  });
  const item = (o: Partial<ManagerBacklogItem>) => asRow<ManagerBacklogItem>({
    id: 1, key: 'K-1', title: 'T', status: 'open', priority: 'high', businessValue: 50, businessValueRationale: null,
    managerRank: 2, dueDate: null, assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null, ...o,
  });

  it('is read-only, ranked ascending, with unranked rows last', () => {
    expect(d.entity).toBeNull();
    expect(d.defaultSort).toEqual({ key: 'rank', dir: 'asc' });
    const rank = d.columns.find((c) => c.key === 'rank')!;
    expect(rank.compare!(item({ managerRank: 1 }), item({ managerRank: null }))).toBeLessThan(0);
  });

  it('renders every cell and the card', () => {
    const row = item({ dueDate: '2026-01-02', assignedUserId: 'u1' });
    for (const col of d.columns) expect(() => render(<div>{col.cell(row)}</div>)).not.toThrow();
    expect(render(<div>{d.card(row)}</div>).container.textContent).toContain('K-1');
    expect(d.rowId(row)).toBe('1');
  });
});

describe('managerRunTasksDescriptor', () => {
  const d = managerRunTasksDescriptor({
    key: 'Key', status: 'Status', result: 'Result', owner: 'Owner', when: 'When',
    statusLabel: (s) => `status:${s}`, ownerName: () => 'Ann', systemOwner: 'System', whenText: () => 'now',
  });
  const task = asRow<ManagerRunTask>({
    id: 5, key: 'T-5', title: 'Pass', status: 'blocked', summary: null,
    assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null, createdAt: '2026-01-01', completedAt: null,
  });

  it('maps unknown statuses to open', () => {
    expect(runTaskStatusKey('weird')).toBe('open');
    expect(runTaskStatusKey('done')).toBe('done');
  });

  it('labels the status pill and attributes an unowned pass to the system', () => {
    expect(render(<div>{d.columns.find((c) => c.key === 'status')!.cell(task)}</div>).container.textContent).toContain('status:blocked');
    expect(render(<div>{d.columns.find((c) => c.key === 'owner')!.cell(task)}</div>).container.textContent).toBe('System');
  });
});

describe('managerActivityDescriptor', () => {
  const d = managerActivityDescriptor({ summary: 'S', type: 'Type', when: 'When', typeLabel: (a) => a.actionType, whenText: (a) => a.createdAt });
  const act = (o: Partial<ManagerAction>) => asRow<ManagerAction>({
    id: 'a1', taskId: 9, ticketKey: 'K-9', ticketTitle: 'Nine', actionType: 'assign', summary: 'did it', detail: 'because', createdAt: '2026-01-02', ...o,
  });

  it('renders the ticket link, summary and detail', () => {
    const { container } = render(<div>{d.columns[0].cell(act({}))}</div>);
    expect(container.textContent).toContain('K-9 · Nine');
    expect(container.textContent).toContain('did it');
    expect(container.textContent).toContain('because');
  });

  it('omits the ticket link when the action has no task', () => {
    expect(render(<div>{d.columns[0].cell(act({ taskId: null }))}</div>).container.querySelector('a')).toBeNull();
  });
});

describe('managerStallsDescriptor', () => {
  const d = managerStallsDescriptor({
    ticket: 'T', cause: 'C', doing: 'D', attempts: 'A', stuckFor: 'S',
    causeLabel: () => 'why', lastTried: (r) => (r.lastAttemptAt ? 'tried' : null), needsYou: 'Needs you', attemptsText: () => '1 of 3', idle: (ms) => `${ms}ms`,
  });
  const row = (o: Partial<StallWatchRow>) => asRow<StallWatchRow>({
    taskId: 3, title: 'Stuck one', status: 'open', cause: 'blocked', detail: 'waiting', attempts: 1, idleMs: 10, lastAttemptAt: null, escalatedAt: null, ...o,
  });

  it('shows "needs you" once escalated', () => {
    const attempts = d.columns.find((c) => c.key === 'attempts')!;
    expect(render(<div>{attempts.cell(row({}))}</div>).container.textContent).toBe('1 of 3');
    expect(render(<div>{attempts.cell(row({ escalatedAt: '2026-01-01' }))}</div>).container.textContent).toBe('Needs you');
  });

  it('is read-only and keyed by task id', () => {
    expect(d.entity).toBeNull();
    expect(d.rowId(row({ taskId: 42 }))).toBe('42');
  });
});
