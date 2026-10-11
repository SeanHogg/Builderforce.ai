import { describe, expect, it } from 'vitest';
import { canRunInParallel, executeHandOff, parseHandOff, planMessage, type HandOffPorts, type HandOffTask } from './planHandoff';
import { isMidTurnMetadata, subagentReportMessage, subagentReportMetadata } from '@builderforce/agent-loop';

const task = (title: string, paths: string[] = []): HandOffTask => ({ title, brief: `do ${title}`, paths });

describe('parseHandOff', () => {
  it('accepts a summary and tasks, trimming and defaulting paths', () => {
    expect(parseHandOff({ summary: ' s ', tasks: [{ title: ' A ', brief: 'b', paths: ['x', ''] }] })).toEqual({
      summary: 's',
      tasks: [{ title: 'A', brief: 'b', paths: ['x'] }],
    });
  });

  it('refuses a plan with no tasks, or a task with no brief, with the fix in the message', () => {
    expect(parseHandOff({ summary: 's', tasks: [] })).toContain('at least one task');
    expect(parseHandOff({ tasks: [{ title: 'A' }] })).toContain('title and a brief');
  });
});

describe('canRunInParallel', () => {
  it('needs two or more tasks, each owning paths, none overlapping', () => {
    expect(canRunInParallel([task('A', ['a']), task('B', ['b'])])).toBe(true);
    expect(canRunInParallel([task('A', ['a'])])).toBe(false);
    expect(canRunInParallel([task('A', ['a']), task('B')])).toBe(false);
    expect(canRunInParallel([task('A', ['src']), task('B', ['src/b.ts'])])).toBe(false);
  });
});

describe('planMessage', () => {
  it('lists the tasks with their tickets and says when they run side by side', () => {
    const text = planMessage({ summary: 'why', tasks: [task('A', ['a']), task('B')] }, [7, undefined], true);
    expect(text).toContain('Plan — 2 tasks');
    expect(text).toContain('side by side');
    expect(text).toContain('1. #7 A — a');
    expect(text).toContain('2. B');
  });
});

describe('executeHandOff', () => {
  const ports = (over: Partial<HandOffPorts> & { log?: string[] } = {}): HandOffPorts => ({
    runTool: async (name, args) => {
      over.log?.push(name);
      if (name === 'builtin_tasks_create') return { id: 100 + (over.log?.filter((n) => n === name).length ?? 0) };
      if (name === 'spawn_agents') {
        const ws = args.workstreams as unknown[];
        return { ok: true, workstreams: ws.map(() => ({ ok: true })), changedFiles: [`f${ws.length}`] };
      }
      return { ok: true };
    },
    toolNames: new Set(['builtin_tasks_create', 'spawn_agents']),
    projectId: 1,
    ...over,
  });

  it('runs more than four tasks in batches of four, merging what they changed', async () => {
    const log: string[] = [];
    const tasks = Array.from({ length: 6 }, (_, i) => task(`T${i}`, [`p${i}`]));
    const out = await executeHandOff({ summary: '', tasks }, ports({ log }));
    expect(log.filter((n) => n === 'spawn_agents')).toHaveLength(2);
    expect(out.mode).toBe('parallel');
    expect(out.workstreams).toHaveLength(6);
    expect(out.changedFiles).toEqual(['f4', 'f2']);
    expect(out.tickets.map((t) => t.id)).toEqual([101, 102, 103, 104, 105, 106]);
  });

  it('falls back to the coder, in order, when the fan-out refuses before any child starts', async () => {
    const out = await executeHandOff(
      { summary: '', tasks: [task('A', ['a']), task('B', ['b'])] },
      ports({ runTool: async (name) => (name === 'spawn_agents' ? { ok: false, error: 'no write gate' } : { id: 1 }) }),
    );
    expect(out.mode).toBe('inline');
    expect(out.next).toContain('Implement the tasks below in order');
  });

  it('still hands off when tickets cannot be filed — the work matters more than its card', async () => {
    const out = await executeHandOff({ summary: '', tasks: [task('A')] }, ports({ toolNames: new Set(), projectId: undefined }));
    expect(out.tickets).toEqual([{ title: 'A' }]);
    expect(out.mode).toBe('inline');
  });
});

describe('subagentReportMessage', () => {
  it('names the agent, the ticket, the outcome and the files', () => {
    const text = subagentReportMessage({ ok: true, label: 'One StatTile', ticket: '901', asAgent: { name: 'Ada' }, output: 'Moved it.', changedFiles: ['a.tsx'] });
    expect(text).toContain('**Ada — #901 One StatTile** · done');
    expect(text).toContain('Moved it.');
    expect(text).toContain('`a.tsx`');
  });

  it('does not repeat a ticket the label already carries, and reports a failure', () => {
    const text = subagentReportMessage({ ok: false, label: '#901 One StatTile', ticket: '901', error: 'model unavailable' });
    expect(text).toContain('**#901 One StatTile** · failed');
    expect(text).toContain('model unavailable');
  });

  it('is tagged mid-turn, so Evermind never learns a progress report as an answer', () => {
    expect(isMidTurnMetadata(subagentReportMetadata({ ok: true, label: 'x' }))).toBe(true);
  });
});
