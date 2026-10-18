import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  membershipChanged: vi.fn(),
  writeAdminAudit: vi.fn(),
  invalidateTaskAssignees: vi.fn(),
}));
vi.mock('./membershipChanged', () => ({ membershipChanged: m.membershipChanged }));
vi.mock('../../infrastructure/audit/adminAudit', () => ({ writeAdminAudit: m.writeAdminAudit }));
vi.mock('../task/taskAssigneeCache', () => ({ invalidateTaskAssignees: m.invalidateTaskAssignees }));

import { TenantRole } from '../../domain/shared/types';
import { changeMemberRole } from './memberRoleChange';

const env = {} as never;

/** A drizzle stub: the member lookup answers `memberRows`; the update records its `set`. */
function makeDb(memberRows: unknown[]) {
  const updates: unknown[] = [];
  const select = { from: () => select, where: () => select, limit: async () => memberRows };
  return {
    updates,
    db: {
      select: () => select,
      update: () => ({ set: (v: unknown) => { updates.push(v); return { where: async () => undefined }; } }),
    } as never,
  };
}

const input = { tenantId: 7, actorUserId: 'actor', targetUserId: 'u9', role: TenantRole.MANAGER };

describe('changeMemberRole — one use case, manager and platform-admin scopes', () => {
  beforeEach(() => { for (const fn of Object.values(m)) fn.mockReset().mockResolvedValue(undefined); });

  it('manager scope: goes through the aggregate (its member rules) and clears the assignee cache', async () => {
    const tenant = { id: 7 };
    const tenantService = { changeMemberRole: vi.fn(async () => tenant) };
    const { db, updates } = makeDb([]);
    const result = await changeMemberRole(db, env, { kind: 'tenant_manager', tenantService: tenantService as never }, input);
    expect(result).toEqual({ ok: true, tenant });
    expect(tenantService.changeMemberRole).toHaveBeenCalledWith(7, 'actor', 'u9', 'manager');
    expect(updates).toEqual([]);
    expect(m.writeAdminAudit).not.toHaveBeenCalled();
    expect(m.invalidateTaskAssignees).toHaveBeenCalledWith(env, 7);
  });

  it('manager scope: an aggregate refusal propagates and nothing is invalidated', async () => {
    const tenantService = { changeMemberRole: vi.fn(async () => { throw new Error('Forbidden'); }) };
    await expect(changeMemberRole(makeDb([]).db, env, { kind: 'tenant_manager', tenantService: tenantService as never }, input))
      .rejects.toThrow('Forbidden');
    expect(m.invalidateTaskAssignees).not.toHaveBeenCalled();
  });

  it('admin scope: overrides the role directly, announces, audits, and clears the assignee cache', async () => {
    const { db, updates } = makeDb([{ id: 'tm-1' }]);
    const result = await changeMemberRole(db, env, { kind: 'platform_admin', ipAddress: '1.2.3.4' }, input);
    expect(result).toEqual({ ok: true, tenant: null });
    expect(updates).toEqual([{ role: 'manager' }]);
    expect(m.membershipChanged).toHaveBeenCalledWith(env, 7, ['u9']);
    expect(m.writeAdminAudit).toHaveBeenCalledWith(db, 'USER_PERSONA_CHANGED', 'actor', {
      targetUserId: 'u9', tenantId: 7, metadata: { newRole: 'manager' }, ipAddress: '1.2.3.4',
    });
    expect(m.invalidateTaskAssignees).toHaveBeenCalledWith(env, 7);
  });

  it('admin scope: a person who is not in that workspace is not_member, nothing written', async () => {
    const { db, updates } = makeDb([]);
    expect(await changeMemberRole(db, env, { kind: 'platform_admin', ipAddress: null }, input))
      .toEqual({ ok: false, reason: 'not_member' });
    expect(updates).toEqual([]);
    expect(m.writeAdminAudit).not.toHaveBeenCalled();
  });
});
