import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ broadcastProjectChanged: vi.fn() }));

vi.mock('../../infrastructure/relay/broadcastRoom', () => ({
  broadcastProjectChanged: mocks.broadcastProjectChanged,
}));

import { deleteLaneAssignments, insertLaneAssignment } from './laneAgentAssignments';

/** A db whose insert/delete return `rows` and whose project lookup resolves to project 42. */
function fakeDb(rows: Array<{ id: string }>) {
  const lookup = { from: () => lookup, innerJoin: () => lookup, where: () => Promise.resolve([{ projectId: 42 }]) };
  return {
    insert: () => ({ values: () => ({ returning: () => Promise.resolve(rows) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }),
    selectDistinct: () => lookup,
  } as never;
}

const ENV = { SESSION_ROOM: {} } as never;
const LANE = '22222222-2222-4222-8222-222222222222';

describe('lane staffing write seam publishes the project change event', () => {
  beforeEach(() => mocks.broadcastProjectChanged.mockReset());

  it('insert publishes for the lane\'s project', async () => {
    const row = await insertLaneAssignment(fakeDb([{ id: 'a1' }]), ENV, {
      tenantId: 7, swimlaneId: LANE, agentKind: 'workforce', agentRef: 'x', role: 'dev',
    });
    expect(row).toEqual({ id: 'a1' });
    expect(mocks.broadcastProjectChanged).toHaveBeenCalledWith(ENV, 7, 42);
  });

  it('delete publishes when a row was removed', async () => {
    const ids = await deleteLaneAssignments(fakeDb([{ id: 'a1' }]), ENV, 7, LANE);
    expect(ids).toEqual(['a1']);
    expect(mocks.broadcastProjectChanged).toHaveBeenCalledWith(ENV, 7, 42);
  });

  it('delete publishes nothing when nothing matched', async () => {
    await deleteLaneAssignments(fakeDb([]), ENV, 7, LANE);
    expect(mocks.broadcastProjectChanged).not.toHaveBeenCalled();
  });
});
