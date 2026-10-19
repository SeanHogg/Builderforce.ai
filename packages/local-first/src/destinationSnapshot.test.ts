import { describe, expect, it, vi } from 'vitest';
import {
  adoptOnSignIn,
  readChildDestination,
  resolveDestination,
  snapshotChildDestination,
  snapshotDestination,
} from './destinationSnapshot.js';
import { destinationKey, type EntityDestination } from './records.js';

const CAPTURED_AT = '2026-10-18T12:00:00.000Z';

describe('destination snapshot', () => {
  it('copies account, tenant, and project into a frozen snapshot taken at creation', () => {
    const input = {
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    };
    const snapshot = snapshotDestination(input);

    expect(snapshot).toEqual({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    });
    expect(snapshot).not.toBe(input);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshotDestination({ kind: 'unbound', capturedAt: CAPTURED_AT }))).toBe(true);
  });

  it('keeps unknown identity null instead of leaving fields to be filled in later', () => {
    const unbound: EntityDestination = { kind: 'unbound' };
    expect(snapshotDestination({ ...unbound, capturedAt: CAPTURED_AT })).toEqual({
      accountId: null,
      tenantId: null,
      projectId: null,
      capturedAt: CAPTURED_AT,
    });
    expect(snapshotDestination({ kind: 'bound', tenantId: 'tenant-a', capturedAt: CAPTURED_AT })).toEqual({
      accountId: null,
      tenantId: 'tenant-a',
      projectId: null,
      capturedAt: CAPTURED_AT,
    });
  });

  it('does not follow a mutation of the selection it was copied from', () => {
    const input: { accountId: string; tenantId: string; projectId: string; capturedAt: string } = {
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    };
    const snapshot = snapshotDestination(input);
    input.tenantId = 'tenant-b';
    input.projectId = 'project-2';
    expect(snapshot.tenantId).toBe('tenant-a');
    expect(snapshot.projectId).toBe('project-1');
  });

  it('stamps capturedAt when the caller does not supply one', () => {
    const before = Date.now();
    const snapshot = snapshotDestination({ accountId: 'acct-1', tenantId: 'tenant-a', projectId: 'project-1' });
    const after = Date.now();
    const stamped = Date.parse(snapshot.capturedAt);
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});

describe('resolveDestination', () => {
  it('always returns the creation snapshot and ignores a later live selection', () => {
    const snapshot = snapshotDestination({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    });
    const liveSelection = {
      accountId: 'acct-2',
      tenantId: 'tenant-b',
      projectId: 'project-9',
    };

    expect(resolveDestination(snapshot, liveSelection)).toBe(snapshot);
    expect(resolveDestination(snapshot, { kind: 'bound', tenantId: 'tenant-b', projectId: 'project-9' })).toBe(snapshot);
    expect(resolveDestination(snapshot, { kind: 'unbound' })).toBe(snapshot);
    expect(snapshot).toEqual({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    });
  });
});

describe('adoptOnSignIn', () => {
  it('does not rewrite a null tenant to whoever signs in next', () => {
    const snapshot = snapshotDestination({ kind: 'unbound', capturedAt: CAPTURED_AT });
    const after = adoptOnSignIn(snapshot, 'tenant-b');

    expect(after).toBe(snapshot);
    expect(after.tenantId).toBeNull();
    expect(after.accountId).toBeNull();
    expect(after.projectId).toBeNull();
  });

  it('keeps tenant A when a different tenant signs in', () => {
    const snapshot = snapshotDestination({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    });
    const after = adoptOnSignIn(snapshot, 'tenant-b');

    expect(after).toBe(snapshot);
    expect(after.tenantId).toBe('tenant-a');
    expect(after.accountId).toBe('acct-1');
    expect(after.projectId).toBe('project-1');
  });

  it('does not rewrite the snapshot when the signed-in tenant matches', () => {
    const snapshot = snapshotDestination({
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
      capturedAt: CAPTURED_AT,
    });
    expect(adoptOnSignIn(snapshot, 'tenant-a')).toBe(snapshot);
    expect(adoptOnSignIn(snapshot, null)).toBe(snapshot);
    expect(snapshot.tenantId).toBe('tenant-a');
  });
});

const PARENT_DESTINATION: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'acct-1',
  tenantId: 'tenant-a',
  projectId: 'project-1',
  repository: 'org/repo',
};

const MOVED_DESTINATION: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://other.example',
  accountId: 'acct-2',
  tenantId: 'tenant-b',
  projectId: 'project-9',
  repository: 'other/repo',
};

describe('child destination snapshot', () => {
  it('stores the destination key captured at creation, not a pointer to the parent', () => {
    const parent: { destination: EntityDestination } = {
      destination: { ...PARENT_DESTINATION },
    };
    const captured = destinationKey(parent.destination);
    const child = snapshotChildDestination(parent, CAPTURED_AT);

    expect(child).toEqual({ destinationKey: captured, capturedAt: CAPTURED_AT });
    expect(child).not.toBe(parent);
    expect(Object.isFrozen(child)).toBe(true);
    expect(child.destinationKey).toBe(destinationKey(PARENT_DESTINATION));
  });

  it('does not move the child when the parent destination changes later', () => {
    const parent: { destination: EntityDestination; destinationKey?: string } = {
      destination: { ...PARENT_DESTINATION },
    };
    const captured = destinationKey(parent.destination);
    const child = snapshotChildDestination(parent, CAPTURED_AT);

    parent.destination = { ...MOVED_DESTINATION };
    parent.destinationKey = destinationKey(MOVED_DESTINATION);
    const taskProjectId = vi.fn(() => parent.destination);

    expect(readChildDestination(child, taskProjectId)).toBe(captured);
    expect(readChildDestination(child, parent)).toBe(captured);
    expect(taskProjectId).not.toHaveBeenCalled();
    expect(child.destinationKey).toBe(captured);
    expect(destinationKey(parent.destination)).not.toBe(child.destinationKey);
    expect(child.destinationKey).not.toBe(parent.destinationKey);
  });

  it('does not follow an in-place mutation of the parent destination object', () => {
    const destination: EntityDestination = {
      kind: 'bound',
      tenantId: 'tenant-a',
      projectId: 'project-1',
    };
    const parent = { destination };
    const child = snapshotChildDestination(parent, CAPTURED_AT);
    const captured = child.destinationKey;
    if (destination.kind === 'bound') {
      destination.tenantId = 'tenant-b';
      destination.projectId = 'project-moved';
    }
    const liveLookup = vi.fn(() => destinationKey(destination));

    expect(readChildDestination(child, liveLookup)).toBe(captured);
    expect(readChildDestination(child, liveLookup)).toBe(
      destinationKey({ kind: 'bound', tenantId: 'tenant-a', projectId: 'project-1' }),
    );
    expect(liveLookup).not.toHaveBeenCalled();
    expect(destinationKey(destination)).not.toBe(child.destinationKey);
  });

  it('reads the parent snapshot field instead of a live destination that has already moved', () => {
    const snapshotted = destinationKey(PARENT_DESTINATION);
    const parent = {
      destinationKey: snapshotted,
      destination: { ...MOVED_DESTINATION },
    };
    const taskProjectId = vi.fn(() => MOVED_DESTINATION);
    const child = snapshotChildDestination(parent, CAPTURED_AT);

    expect(child.destinationKey).toBe(snapshotted);
    expect(child.destinationKey).not.toBe(destinationKey(parent.destination));
    expect(readChildDestination(child, taskProjectId)).toBe(snapshotted);
    expect(taskProjectId).not.toHaveBeenCalled();
  });

  it('keeps an unbound child unbound after the parent is later bound', () => {
    const parent: { destination: EntityDestination } = { destination: { kind: 'unbound' } };
    const child = snapshotChildDestination(parent, CAPTURED_AT);
    parent.destination = { ...MOVED_DESTINATION };
    const taskProjectId = vi.fn(() => parent.destination);

    expect(child.destinationKey).toBe('unbound');
    expect(readChildDestination(child, taskProjectId)).toBe('unbound');
    expect(taskProjectId).not.toHaveBeenCalled();
  });

  it('does not call a live parent lookup when the snapshot field is missing', () => {
    const taskProjectId = vi.fn(() => MOVED_DESTINATION);

    expect(() => readChildDestination({ destinationKey: '' }, taskProjectId)).toThrow(/destination_snapshot_required/);
    expect(() => readChildDestination({ destinationKey: null }, taskProjectId)).toThrow(/destination_snapshot_required/);
    expect(() => snapshotChildDestination({ destinationKey: '   ' })).toThrow(/destination_snapshot_required/);
    expect(() => snapshotChildDestination(taskProjectId as never)).toThrow(/destination_snapshot_required/);
    expect(taskProjectId).not.toHaveBeenCalled();
  });

  it('does not export a rebind operation', async () => {
    const mod = await import('./destinationSnapshot.js');
    expect(Object.keys(mod).some((name) => name.toLowerCase().includes('rebind'))).toBe(false);
    expect(mod).not.toHaveProperty('rebindDestination');
    expect(mod).not.toHaveProperty('rebind');
  });
});
