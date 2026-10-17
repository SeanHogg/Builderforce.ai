import { describe, expect, it } from 'vitest';
import { mutationCanTriggerLaneEntry } from './laneEntryChange';

const row = { projectId: 1, status: 'todo', assignedAgentRef: null as string | null, taskType: 'task', actionType: null as string | null };

describe('mutationCanTriggerLaneEntry', () => {
  it('always evaluates a create (no before)', () => {
    expect(mutationCanTriggerLaneEntry(null, row)).toBe(true);
    expect(mutationCanTriggerLaneEntry(undefined, row)).toBe(true);
  });

  it('skips a write that touched no trigger input (title, priority, dates)', () => {
    expect(mutationCanTriggerLaneEntry(row, { ...row })).toBe(false);
  });

  it('evaluates a lane change and a board change', () => {
    expect(mutationCanTriggerLaneEntry(row, { ...row, status: 'in_progress' })).toBe(true);
    expect(mutationCanTriggerLaneEntry({ projectId: 1 }, { projectId: 2 })).toBe(true);
    expect(mutationCanTriggerLaneEntry({ projectId: 1 }, { projectId: 1 })).toBe(false);
  });

  it('evaluates a NEW owner agent but not clearing the owner', () => {
    expect(mutationCanTriggerLaneEntry(row, { ...row, assignedAgentRef: 'agent:dev' })).toBe(true);
    const owned = { ...row, assignedAgentRef: 'agent:dev' };
    expect(mutationCanTriggerLaneEntry(owned, { ...owned })).toBe(false);
    expect(mutationCanTriggerLaneEntry(owned, { ...owned, assignedAgentRef: null })).toBe(false);
    expect(mutationCanTriggerLaneEntry(owned, { ...owned, assignedAgentRef: 'agent:qa' })).toBe(true);
  });

  it('evaluates a task/action type change (managed-stage applicability)', () => {
    expect(mutationCanTriggerLaneEntry(row, { ...row, taskType: 'epic' })).toBe(true);
    expect(mutationCanTriggerLaneEntry(row, { ...row, actionType: 'review' })).toBe(true);
  });

  it('does not compare a field the write did not carry', () => {
    expect(mutationCanTriggerLaneEntry(row, { status: 'todo' })).toBe(false);
    expect(mutationCanTriggerLaneEntry({ ...row, actionType: 'review' }, { status: 'todo', projectId: 1 })).toBe(false);
  });

  it('treats null and undefined as the same "unset" value', () => {
    expect(mutationCanTriggerLaneEntry({ status: 'todo', taskType: undefined }, { status: 'todo', taskType: null })).toBe(false);
  });
});
