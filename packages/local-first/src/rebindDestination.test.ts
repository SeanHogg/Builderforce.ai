import { describe, expect, it, vi } from 'vitest';
import { destinationKey, type EntityDestination } from './records.js';
import { newLocalRecord } from './store.js';
import {
  DESTINATION_REQUIRED,
  LIVE_PARENT_LOOKUP_REFUSED,
  readDestination,
  rebindDestination,
} from './rebindDestination.js';

const CAPTURED: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-1',
  repository: 'org/repo',
};

const NEXT: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-2',
  repository: 'org/repo',
};

function ticket(destination: EntityDestination, parentId = 'project-1') {
  return newLocalRecord({
    id: 'ticket-1',
    entityType: 'ticket',
    payload: { title: 'Offline ticket', status: 'open', projectId: parentId },
    deviceId: 'device-a',
    occurredAt: '2026-10-18T12:00:00.000Z',
    destination,
  });
}

describe('readDestination', () => {
  it('returns the destinationKey snapshotted on the record', () => {
    const record = ticket(CAPTURED);
    expect(readDestination(record)).toBe(destinationKey(CAPTURED));
    expect(readDestination(record)).toBe(destinationKey(record.destination));
    expect(readDestination.length).toBe(1);
  });

  it('does not accept a live parent id and does not call a lookup', () => {
    const record = ticket(CAPTURED);
    const taskProjectId = vi.fn(() => 'project-9');

    expect(() => readDestination(record, 'project-9' as never)).toThrow(LIVE_PARENT_LOOKUP_REFUSED);
    expect(() => readDestination(record, taskProjectId as never)).toThrow(LIVE_PARENT_LOOKUP_REFUSED);
    expect(taskProjectId).not.toHaveBeenCalled();
    expect(readDestination(record)).toBe(destinationKey(CAPTURED));
  });

  it('does not invoke a destination getter', () => {
    const taskProjectId = vi.fn(() => CAPTURED);
    const record = {
      id: 'ticket-1',
      get destination(): EntityDestination {
        return taskProjectId();
      },
    };

    expect(() => readDestination(record)).toThrow(LIVE_PARENT_LOOKUP_REFUSED);
    expect(taskProjectId).not.toHaveBeenCalled();
  });

  it('does not read a live parent through a destination field getter', () => {
    const taskProjectId = vi.fn(() => 'project-9');
    const destination = {
      kind: 'bound' as const,
      tenantId: 'tenant-a',
      get projectId(): string {
        return taskProjectId();
      },
    };
    const record = ticket(destination);

    expect(readDestination(record)).toBe(destinationKey({ kind: 'bound', tenantId: 'tenant-a' }));
    expect(readDestination(record)).not.toContain('project-9');
    expect(taskProjectId).not.toHaveBeenCalled();
  });

  it('does not change the record destinationKey when a separate live parent id changes', () => {
    const liveParent = { id: 'project-1' };
    const record = {
      ...ticket(CAPTURED, liveParent.id),
      parent: liveParent,
    };
    const before = readDestination(record);

    liveParent.id = 'project-9';

    expect(readDestination(record)).toBe(before);
    expect(readDestination(record)).toBe(destinationKey(CAPTURED));
    expect(readDestination(record)).not.toContain('project-9');
    expect(record.parent.id).toBe('project-9');
    expect(record.destination).toEqual(CAPTURED);
  });

  it('reads an unbound snapshot as unbound after the parent is later bound', () => {
    const liveParent = { id: 'project-1', destination: { kind: 'unbound' } as EntityDestination };
    const record = ticket({ kind: 'unbound' });
    liveParent.destination = { ...NEXT };
    liveParent.id = 'project-2';

    expect(readDestination(record)).toBe('unbound');
    expect(readDestination(record)).not.toBe(destinationKey(liveParent.destination));
  });
});

describe('rebindDestination', () => {
  it('returns a new record and leaves the old destination key in place', () => {
    const record = ticket(CAPTURED);
    const before = readDestination(record);
    const rebound = rebindDestination(record, NEXT);

    expect(rebound).not.toBe(record);
    expect(rebound.destination).not.toBe(NEXT);
    expect(rebound.destination).toEqual(NEXT);
    expect(Object.isFrozen(rebound.destination)).toBe(true);
    expect(readDestination(rebound)).toBe(destinationKey(NEXT));
    expect(readDestination(record)).toBe(before);
    expect(record.destination).toEqual(CAPTURED);
    expect(rebound.id).toBe(record.id);
    expect(rebound.payload).toEqual(record.payload);
  });

  it('does not follow a later mutation of the destination it copied', () => {
    const record = ticket(CAPTURED);
    const next: EntityDestination = { ...NEXT };
    const rebound = rebindDestination(record, next);
    if (next.kind === 'bound') next.projectId = 'project-mutated';

    expect(readDestination(rebound)).toBe(destinationKey(NEXT));
    expect(rebound.destination).toEqual(NEXT);
    expect(readDestination(record)).toBe(destinationKey(CAPTURED));
  });

  it('does not call a lookup when the new destination is a function or a parent id', () => {
    const record = ticket(CAPTURED);
    const taskProjectId = vi.fn(() => NEXT);

    expect(() => rebindDestination(record, taskProjectId as never)).toThrow(LIVE_PARENT_LOOKUP_REFUSED);
    expect(() => rebindDestination(record, 'project-9' as never)).toThrow(DESTINATION_REQUIRED);
    expect(() => rebindDestination(record, NEXT, taskProjectId as never)).toThrow(LIVE_PARENT_LOOKUP_REFUSED);
    expect(taskProjectId).not.toHaveBeenCalled();
    expect(readDestination(record)).toBe(destinationKey(CAPTURED));
    expect(record.destination).toEqual(CAPTURED);
  });

  it('does not move the old record when a live parent id changes after rebind', () => {
    const liveParent = { id: 'project-1' };
    const record = {
      ...ticket(CAPTURED, liveParent.id),
      parent: liveParent,
    };
    const rebound = rebindDestination(record, NEXT);

    liveParent.id = 'project-9';

    expect(readDestination(record)).toBe(destinationKey(CAPTURED));
    expect(readDestination(rebound)).toBe(destinationKey(NEXT));
    expect(readDestination(record)).not.toContain('project-9');
    expect(readDestination(rebound)).not.toContain('project-9');
  });
});
