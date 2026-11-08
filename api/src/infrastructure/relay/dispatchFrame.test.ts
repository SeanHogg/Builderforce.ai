import { describe, expect, it } from 'vitest';
import { validateDispatchFrame } from './dispatchFrame';

const good = { type: 'task.assign', executionId: 12, taskId: 3, payload: '{}', task: { title: 'Ship it', description: null } };

describe('validateDispatchFrame', () => {
  it('accepts a well-formed task.assign and returns the frame untouched', () => {
    const r = validateDispatchFrame(good);
    expect(r).toEqual({ ok: true, frame: good });
  });

  it('accepts a task.assign with only the required task title', () => {
    expect(validateDispatchFrame({ type: 'task.assign', task: { title: 'x' } }).ok).toBe(true);
  });

  it('rejects a task.assign with no task', () => {
    expect(validateDispatchFrame({ type: 'task.assign', executionId: 1 })).toEqual({ ok: false, error: 'task_required' });
    expect(validateDispatchFrame({ type: 'task.assign', task: 'nope' })).toEqual({ ok: false, error: 'task_required' });
  });

  it('rejects a missing, blank or non-string title', () => {
    for (const title of [undefined, '', '   ', 5]) {
      expect(validateDispatchFrame({ type: 'task.assign', task: { title } })).toEqual({ ok: false, error: 'task_title_required' });
    }
  });

  it('rejects a non-integer or non-positive execution / task id', () => {
    for (const executionId of ['12', 0, -1, 1.5, Number.NaN, null]) {
      expect(validateDispatchFrame({ ...good, executionId })).toEqual({ ok: false, error: 'execution_id_invalid' });
    }
    expect(validateDispatchFrame({ ...good, taskId: 'x' })).toEqual({ ok: false, error: 'task_id_invalid' });
  });

  it('rejects a non-string payload', () => {
    expect(validateDispatchFrame({ ...good, payload: { a: 1 } })).toEqual({ ok: false, error: 'payload_invalid' });
  });

  it('passes every other frame type through (the door is shared with approvals, repo ops, broadcasts)', () => {
    for (const frame of [{ type: 'task.broadcast', task: {} }, { type: 'agent_dispatch', dispatchId: 'x' }, { type: 'task.finalize' }, null, 'raw', 7]) {
      expect(validateDispatchFrame(frame)).toEqual({ ok: true, frame });
    }
  });
});
