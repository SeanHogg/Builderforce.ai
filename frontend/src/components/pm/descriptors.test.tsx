import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ManagerAction, ManagerBacklogItem, ManagerRunTask, StallWatchRow } from '@/lib/builderforceApi';
import type { PortfolioHealthItem } from '@/lib/pm/portfolioHealth';
import {
  managerActivityDescriptor, managerBacklogDescriptor, managerRunTasksDescriptor, managerStallsDescriptor, runTaskStatusKey,
} from '@/components/manager/managerDescriptors';
import { portfolioHealthDescriptor } from './portfolioHealthDescriptor';
import { roiFeaturesDescriptor, roiProjectsDescriptor, roiTasksDescriptor } from './roiDescriptors';

const money = (n: number) => `$${n}`;
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

  it('is read-only and ranked ascending by default, unranked rows last', () => {
    expect(d.entity).toBeNull();
    expect(d.defaultSort).toEqual({ key: 'rank', dir: 'asc' });
    const rank = d.columns.find((c) => c.key === 'rank')!;
    expect(rank.compare!(item({ managerRank: 1 }), item({ managerRank: null }))).toBeLessThan(0);
  });

  it('renders every column cell and the card without throwing', () => {
    const row = item({ dueDate: '2026-01-02', assignedUserId: 'u1' });
    for (const col of d.columns) expect(() => render(<div>{col.cell(row)}</div>)).not.toThrow();
    const { container } = render(<div>{d.card(row)}</div>);
    expect(container.textContent).toContain('K-1');
    expect(d.rowId(row)).toBe('1');
  });

  it('shows the unassigned label for an unowned row', () => {
    const { container } = render(<div>{d.columns.find((c) => c.key === 'assignee')!.cell(item({}))}</div>);
    expect(container.textContent).toBe('Unassigned');
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

  it('maps unknown statuses to open and labels the pill', () => {
    expect(runTaskStatusKey('weird')).toBe('open');
    const { container } = render(<div>{d.columns.find((c) => c.key === 'status')!.cell(task)}</div>);
    expect(container.textContent).toContain('status:blocked');
  });

  it('attributes an unowned pass to the system service', () => {
    const { container } = render(<div>{d.columns.find((c) => c.key === 'owner')!.cell(task)}</div>);
    expect(container.textContent).toBe('System');
    expect(d.entity).toBeNull();
  });
});

describe('managerActivityDescriptor', () => {
  const d = managerActivityDescriptor({ summary: 'S', type: 'Type', when: 'When', typeLabel: (a) => a.actionType, whenText: (a) => a.createdAt });
  const act = (o: Partial<ManagerAction>) => asRow<ManagerAction>({
    id: 'a1', taskId: 9, ticketKey: 'K-9', ticketTitle: 'Nine', actionType: 'assign', summary: 'did it', detail: 'because', createdAt: '2026-01-02', ...o,
  });

  it('renders the ticket link, summary and detail; sorts newest-first by default', () => {
    const { container } = render(<div>{d.columns[0].cell(act({}))}</div>);
    expect(container.textContent).toContain('K-9 · Nine');
    expect(container.textContent).toContain('did it');
    expect(container.textContent).toContain('because');
    expect(d.defaultSort).toEqual({ key: 'when', dir: 'desc' });
    expect(d.columns.find((c) => c.key === 'when')!.compare!(act({ createdAt: '2026-01-01' }), act({ createdAt: '2026-01-03' }))).toBeLessThan(0);
  });

  it('omits the ticket link when the action has no task', () => {
    const { container } = render(<div>{d.columns[0].cell(act({ taskId: null }))}</div>);
    expect(container.querySelector('a')).toBeNull();
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

  it('shows "needs you" once escalated and the attempt count before that', () => {
    const attempts = d.columns.find((c) => c.key === 'attempts')!;
    expect(render(<div>{attempts.cell(row({}))}</div>).container.textContent).toBe('1 of 3');
    expect(render(<div>{attempts.cell(row({ escalatedAt: '2026-01-01' }))}</div>).container.textContent).toBe('Needs you');
  });

  it('shows the last-tried line only when there was an attempt', () => {
    const doing = d.columns.find((c) => c.key === 'doing')!;
    expect(render(<div>{doing.cell(row({}))}</div>).container.textContent).toBe('waiting');
    expect(render(<div>{doing.cell(row({ lastAttemptAt: '2026-01-01' }))}</div>).container.textContent).toContain('tried');
  });

  it('is read-only and keyed by task id', () => {
    expect(d.entity).toBeNull();
    expect(d.rowId(row({ taskId: 42 }))).toBe('42');
  });
});

describe('roi descriptors', () => {
  it('projects: sorts by spend and formats money', () => {
    const d = roiProjectsDescriptor({ project: 'P', completed: 'C', spend: 'S' }, money);
    const a = { projectId: 1, projectName: 'A', completedCount: 1, agentLlmCostUsd: 1 };
    const b = { projectId: 2, projectName: 'B', completedCount: 2, agentLlmCostUsd: 7 };
    expect(d.entity).toBeNull();
    expect(d.columns.find((c) => c.key === 'spend')!.compare!(a, b)).toBeLessThan(0);
    expect(render(<div>{d.columns.find((c) => c.key === 'spend')!.cell(b)}</div>).container.textContent).toBe('$7');
    expect(render(<div>{d.card(a)}</div>).container.textContent).toContain('A');
  });

  it('tasks: prefixes the key when present', () => {
    const d = roiTasksDescriptor({ task: 'T', spend: 'S' }, money);
    const withKey = { taskId: 1, taskKey: 'K-1', title: 'Hello', agentLlmCostUsd: 2 };
    const noKey = { taskId: 2, taskKey: '', title: 'Plain', agentLlmCostUsd: 3 };
    expect(d.label(withKey)).toBe('K-1 · Hello');
    expect(d.label(noKey)).toBe('Plain');
  });

  it('features: falls back to a dash for missing type/status', () => {
    const d = roiFeaturesDescriptor({ feature: 'F', type: 'T', status: 'S' });
    const row = { id: 1, featureName: 'Feat' } as never;
    expect(render(<div>{d.columns.find((c) => c.key === 'type')!.cell(row)}</div>).container.textContent).toBe('—');
    expect(d.rowId(row)).toBe('1');
  });
});

describe('portfolioHealthDescriptor', () => {
  const d = portfolioHealthDescriptor({
    project: 'P', health: 'H', progress: 'G', blocker: 'B', action: 'A',
    rag: (i) => i.rag, progressText: () => 'p', blockerText: () => 'b', actionText: () => 'a',
  });
  const item = (rag: 'red' | 'amber' | 'green', name: string) => asRow<PortfolioHealthItem>({ id: name, name, rag, health: { completed: 1, total: 2, open: 1 } });

  it('is read-only, defaults to Card mode, and orders red before green', () => {
    expect(d.entity).toBeNull();
    expect(d.defaultView).toBe('card');
    expect(d.columns.find((c) => c.key === 'health')!.compare!(item('red', 'a'), item('green', 'b'))).toBeLessThan(0);
  });

  it('links the project cell to its analytics panel', () => {
    const { container } = render(<div>{d.columns[0].cell(item('green', 'x'))}</div>);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/projects?project=x&panel=analytics');
  });
});
