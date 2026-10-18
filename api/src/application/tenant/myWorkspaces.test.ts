import { beforeEach, describe, expect, it, vi } from 'vitest';

const { landPendingInvitations, getDefaultTenantId } = vi.hoisted(() => ({
  landPendingInvitations: vi.fn(),
  getDefaultTenantId: vi.fn(),
}));
vi.mock('./pendingInvitationLanding', () => ({ landPendingInvitations }));
vi.mock('../../infrastructure/repositories/UserRepository', () => ({
  UserRepository: class { getDefaultTenantId = getDefaultTenantId; },
}));
vi.mock('../agent/provisionBuiltinAgents', () => ({ provisionBuiltinAgents: vi.fn() }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { provisionBuiltinAgents as provisionBuiltinAgentsImpl } from '../agent/provisionBuiltinAgents';
import { createWorkspace, listMyWorkspaces } from './myWorkspaces';

const provisionBuiltinAgents = vi.mocked(provisionBuiltinAgentsImpl);

const ROWS = [
  { id: 3, name: 'Hogg', slug: 'hogg', role: 'owner' },
  { id: 9, name: 'Enterprise', slug: 'ent', role: 'developer' },
];
const db = {} as never;
const env = {} as never;

function lister() {
  return {
    listTenantsForUser: vi.fn(async () => ROWS),
    addMember: vi.fn(),
    admitCollaborator: vi.fn(),
  } as never as Parameters<typeof listMyWorkspaces>[2] & { listTenantsForUser: ReturnType<typeof vi.fn> };
}

describe('listMyWorkspaces — the one "my workspaces" list', () => {
  beforeEach(() => {
    landPendingInvitations.mockReset().mockResolvedValue(undefined);
    getDefaultTenantId.mockReset();
  });

  it('lands pending invitations BEFORE listing, so an invitee sees the workspace now', async () => {
    const order: string[] = [];
    landPendingInvitations.mockImplementation(async () => { order.push('land'); });
    const ts = lister();
    ts.listTenantsForUser.mockImplementation(async () => { order.push('list'); return ROWS; });
    getDefaultTenantId.mockResolvedValue(null);
    await listMyWorkspaces(db, env, ts, 'u1');
    expect(order).toEqual(['land', 'list']);
    expect(landPendingInvitations).toHaveBeenCalledWith(db, env, ts, 'u1');
  });

  it('returns the stored default while the account still belongs to it', async () => {
    getDefaultTenantId.mockResolvedValue(9);
    expect(await listMyWorkspaces(db, env, lister(), 'u1')).toEqual({ defaultTenantId: 9, tenants: ROWS });
  });

  it('drops a default the account no longer belongs to', async () => {
    getDefaultTenantId.mockResolvedValue(77);
    expect((await listMyWorkspaces(db, env, lister(), 'u1')).defaultTenantId).toBeNull();
  });
});

describe('createWorkspace — the one create', () => {
  beforeEach(() => provisionBuiltinAgents.mockReset().mockResolvedValue(undefined));

  const service = () => ({ createTenant: vi.fn(async (dto: { name: string }) => ({ id: 42, name: dto.name })) });

  it('refuses a blank name without creating anything', async () => {
    const ts = service();
    expect(await createWorkspace(db, ts as never, { name: '   ', ownerUserId: 'u1' })).toEqual({ ok: false, error: 'name_required' });
    expect(await createWorkspace(db, ts as never, { name: null, ownerUserId: 'u1' })).toEqual({ ok: false, error: 'name_required' });
    expect(ts.createTenant).not.toHaveBeenCalled();
  });

  it('creates with the trimmed name and seeds the built-in agents', async () => {
    const ts = service();
    const result = await createWorkspace(db, ts as never, { name: '  My Team ', ownerUserId: 'u1' });
    expect(result.ok).toBe(true);
    expect(ts.createTenant).toHaveBeenCalledWith({ name: 'My Team', ownerUserId: 'u1' });
    expect(provisionBuiltinAgents).toHaveBeenCalledWith(db, 42);
  });

  it('keeps the workspace when seeding the agents fails', async () => {
    provisionBuiltinAgents.mockRejectedValueOnce(new Error('seed failed'));
    const result = await createWorkspace(db, service() as never, { name: 'Team', ownerUserId: 'u1' });
    expect(result).toMatchObject({ ok: true, tenant: { id: 42 } });
  });
});
