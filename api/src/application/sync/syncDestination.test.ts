import { describe, expect, it } from 'vitest';
import { destinationKey, normaliseSyncDestination } from '../../domain/sync/syncProtocol';
import { mayBindSyncDestination, normalisedKeyOf, resolveSyncDestination } from './syncDestination';
import type { SyncReferenceReader, SyncStores } from './syncPorts';

const AUTH = { tenantId: 7, userId: 'user-7', role: 'developer' };

function stores(options: { mapped?: string[]; owned?: number[] } = {}): Pick<SyncStores, 'findMapping' | 'references'> {
  const references: SyncReferenceReader = {
    projectInTenant: async (tenantId, id) => tenantId === 7 && (options.owned ?? []).includes(id),
    taskInTenant: async () => false,
    tenantMember: async () => false,
  };
  return {
    references,
    findMapping: async (tenantId, entityType, clientEntityId) =>
      tenantId === 7 && entityType === 'project' && (options.mapped ?? []).includes(clientEntityId)
        ? { serverId: '5', serverVersion: 1, payloadHash: 'h', destinationKey: 'k' }
        : null,
  };
}

describe('mayBindSyncDestination — the ONE first-bind policy', () => {
  it('lets a member with project write access (developer+) bind on push', () => {
    for (const role of ['developer', 'manager', 'owner']) expect(mayBindSyncDestination({ ...AUTH, role }, 'push')).toBe(true);
    for (const role of ['viewer', 'contributor', 'member', '']) expect(mayBindSyncDestination({ ...AUTH, role }, 'push')).toBe(false);
  });

  it('lets any member read a destination', () => {
    expect(mayBindSyncDestination({ ...AUTH, role: 'viewer' }, 'pull')).toBe(true);
    expect(mayBindSyncDestination({ ...AUTH, role: 'nobody' }, 'pull')).toBe(false);
  });
});

describe('normaliseSyncDestination — tenant from auth only', () => {
  it('fills an omitted tenant and refuses a contradicting tenant or account', () => {
    expect(normaliseSyncDestination({ kind: 'bound' }, AUTH)).toEqual({ ok: true, destination: { kind: 'bound', tenantId: '7' } });
    expect(normaliseSyncDestination({ kind: 'bound', tenantId: '8' }, AUTH)).toEqual({ ok: false, code: 'destination_tenant_mismatch' });
    expect(normaliseSyncDestination({ kind: 'bound', accountId: 'x' }, AUTH)).toEqual({ ok: false, code: 'destination_account_mismatch' });
    expect(normaliseSyncDestination({ kind: 'unbound' }, AUTH)).toEqual({ ok: false, code: 'sync_destination_required' });
    expect(normalisedKeyOf({ kind: 'bound' }, AUTH)).toBe(normalisedKeyOf({ kind: 'bound', tenantId: '7' }, AUTH));
  });
});

describe('resolveSyncDestination', () => {
  const PROJECT = '77777777-7777-4777-8777-777777777777';

  it('builds the key from the normalised destination', async () => {
    const bound = await resolveSyncDestination({ kind: 'bound', repository: 'r' }, AUTH, stores(), { purpose: 'push' });
    expect(bound).toEqual({
      ok: true,
      destination: { kind: 'bound', repository: 'r', tenantId: '7' },
      key: destinationKey({ kind: 'bound', repository: 'r', tenantId: '7' }),
      projectPending: false,
    });
  });

  it('validates the project before the key: owned decimal, mapped UUID, pending UUID, garbage', async () => {
    const s = stores({ owned: [41], mapped: [PROJECT] });
    expect(await resolveSyncDestination({ kind: 'bound', projectId: '41' }, AUTH, s, { purpose: 'push' })).toMatchObject({ ok: true });
    expect(await resolveSyncDestination({ kind: 'bound', projectId: '42' }, AUTH, s, { purpose: 'push' }))
      .toEqual({ ok: false, status: 400, code: 'destination_project_invalid' });
    expect(await resolveSyncDestination({ kind: 'bound', projectId: PROJECT }, AUTH, s, { purpose: 'push' }))
      .toMatchObject({ ok: true, projectPending: false });
    const other = '88888888-8888-4888-8888-888888888888';
    expect(await resolveSyncDestination({ kind: 'bound', projectId: other }, AUTH, s, { purpose: 'push' }))
      .toMatchObject({ ok: true, projectPending: true });
    expect(await resolveSyncDestination({ kind: 'bound', projectId: other }, AUTH, s, { purpose: 'pull' }))
      .toMatchObject({ ok: true, projectPending: false });
    expect(await resolveSyncDestination({ kind: 'bound', projectId: '../7' }, AUTH, s, { purpose: 'pull' }))
      .toEqual({ ok: false, status: 400, code: 'destination_project_invalid' });
  });

  it('refuses a caller without write access with 403', async () => {
    expect(await resolveSyncDestination({ kind: 'bound' }, { ...AUTH, role: 'viewer' }, stores(), { purpose: 'push' }))
      .toEqual({ ok: false, status: 403, code: 'destination_bind_forbidden' });
  });
});
