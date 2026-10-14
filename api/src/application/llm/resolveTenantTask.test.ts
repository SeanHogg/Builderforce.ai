import { describe, it, expect, vi } from 'vitest';
import { NotFoundError } from '../../domain/shared/errors';
import { resolveTenantTask, titleStartsWithHashRef, type BuiltinCtx } from './builtinToolContext';

function taskRow(id: number, title: string, projectId = 4) {
  return {
    projectId,
    toPlain: () => ({ id, projectId, title, status: 'todo' }),
  };
}

function ctxWith(tasks: {
  getTask: (id: number) => Promise<unknown>;
  listTasks: (...args: unknown[]) => Promise<unknown>;
}): BuiltinCtx {
  return {
    db: {} as never,
    tenantId: 7,
    projects: { getProject: vi.fn(async () => ({ id: 4 })) } as never,
    tasks: tasks as never,
  };
}

describe('titleStartsWithHashRef', () => {
  it('requires a delimiter after the digits', () => {
    expect(titleStartsWithHashRef('#2346: Fix the gap', 2346)).toBe(true);
    expect(titleStartsWithHashRef('#2346:no-space-after-colon', 2346)).toBe(true);
    expect(titleStartsWithHashRef('#2346 space form', 2346)).toBe(true);
    expect(titleStartsWithHashRef('#23460: superstring', 2346)).toBe(false);
    expect(titleStartsWithHashRef('#2346', 2346)).toBe(false);
    expect(titleStartsWithHashRef('2346: no hash', 2346)).toBe(false);
    expect(titleStartsWithHashRef('#2346-hyphen', 2346)).toBe(false);
  });
});

describe('resolveTenantTask', () => {
  it('returns the ticket titled #<n>: when the numeric id 404s', async () => {
    const match = taskRow(99, '#2346: Fix the gap');
    const getTask = vi.fn(async (id: number) => {
      if (id === 2346) throw new NotFoundError('Task', id);
      if (id === 99) return match;
      throw new NotFoundError('Task', id);
    });
    const listTasks = vi.fn(async () => [match, taskRow(12, 'Unrelated')]);
    const result = await resolveTenantTask(ctxWith({ getTask, listTasks }), 2346);
    expect(result.toPlain()).toMatchObject({ id: 99, title: '#2346: Fix the gap' });
    expect(listTasks).toHaveBeenCalledWith(7, undefined, true);
    expect(getTask).toHaveBeenCalledWith(2346);
    expect(getTask).toHaveBeenCalledWith(99);
  });

  it('returns the ticket titled #<n> <rest> when the numeric id 404s', async () => {
    const match = taskRow(88, '#2346 space form');
    const getTask = vi.fn(async (id: number) => {
      if (id === 2346) throw new NotFoundError('Task', id);
      if (id === 88) return match;
      throw new NotFoundError('Task', id);
    });
    const result = await resolveTenantTask(
      ctxWith({ getTask, listTasks: vi.fn(async () => [match]) }),
      2346,
    );
    expect(result.toPlain()).toMatchObject({ id: 88, title: '#2346 space form' });
  });

  it('404 names matching #<n>: tickets when several titles match', async () => {
    const getTask = vi.fn(async (id: number) => {
      throw new NotFoundError('Task', id);
    });
    await expect(
      resolveTenantTask(
        ctxWith({
          getTask,
          listTasks: vi.fn(async () => [
            taskRow(99, '#2346: first'),
            taskRow(100, '#2346: second'),
          ]),
        }),
        2346,
      ),
    ).rejects.toThrow(
      /Task '2346' not found\. Matching titled ticket\(s\): 99 "#2346: first"; 100 "#2346: second"/,
    );
  });

  it('404 names the matching #<n>: ticket when it cannot be loaded', async () => {
    const getTask = vi.fn(async (id: number) => {
      throw new NotFoundError('Task', id);
    });
    await expect(
      resolveTenantTask(
        ctxWith({
          getTask,
          listTasks: vi.fn(async () => [taskRow(99, '#2346: Fix the gap')]),
        }),
        2346,
      ),
    ).rejects.toThrow(/Task '2346' not found\. Matching titled ticket\(s\): 99 "#2346: Fix the gap"/);
  });

  it('404s unchanged when no #<n>: title exists', async () => {
    const getTask = vi.fn(async (id: number) => {
      throw new NotFoundError('Task', id);
    });
    await expect(
      resolveTenantTask(
        ctxWith({
          getTask,
          listTasks: vi.fn(async () => [
            taskRow(12, '#23460: superstring must not match'),
            taskRow(13, 'no hash'),
          ]),
        }),
        2346,
      ),
    ).rejects.toThrow(new NotFoundError('Task', 2346));
  });

  it('does not scan titles when the numeric id exists', async () => {
    const hit = taskRow(9, 'real id');
    const getTask = vi.fn(async (id: number) => {
      if (id === 9) return hit;
      throw new NotFoundError('Task', id);
    });
    const listTasks = vi.fn(async () => []);
    const result = await resolveTenantTask(ctxWith({ getTask, listTasks }), 9);
    expect(result.toPlain()).toMatchObject({ id: 9 });
    expect(listTasks).not.toHaveBeenCalled();
  });

  it('rethrows non-404 errors without scanning titles', async () => {
    const getTask = vi.fn(async () => {
      throw new Error('db down');
    });
    const listTasks = vi.fn(async () => []);
    await expect(resolveTenantTask(ctxWith({ getTask, listTasks }), 2346)).rejects.toThrow('db down');
    expect(listTasks).not.toHaveBeenCalled();
  });
});
