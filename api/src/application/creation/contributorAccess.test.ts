import { describe, expect, it } from 'vitest';
import { requireSessionRole, tenantRoleForSessionRole } from './sessionAccess';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { resolveRolePermissions } from '../../domain/permissions/permissionRegistry';

/**
 * The `contributor` contract, end to end through the real gates:
 *   - the CANVAS gate is the board role, so a contributor seated as an editor writes
 *     the board it is a member of;
 *   - every WORKSPACE gate is a tenant tier or permission, and a contributor clears
 *     none of the write ones.
 */

/** A drizzle-shaped fake whose Nth awaited select resolves to `results[N]`. */
function fakeDb(results: unknown[][]) {
  let call = 0;
  const chain = (): any => {
    const rows = results[call++] ?? [];
    const b: any = {
      from: () => b, innerJoin: () => b, where: () => b,
      limit: () => Promise.resolve(rows),
    };
    return b;
  };
  return { select: () => chain() } as never;
}

const SESSION = { id: 'sess-1', tenantId: 9 };

describe('a canvas contributor', () => {
  it('is what a board editor is seated as', () => {
    expect(tenantRoleForSessionRole('editor')).toBe(TenantRole.CONTRIBUTOR);
  });

  it('writes a canvas it is an editor of — the board role is the gate, not the tenant tier', async () => {
    const db = fakeDb([[{ session: SESSION, role: 'editor' }]]);
    const access = await requireSessionRole(db, 'sess-1', 9, 'guest-1', 'editor');
    expect(access?.role).toBe('editor');
  });

  it('cannot write a canvas it is not a member of', async () => {
    // Neither the tenant-scoped read nor the superadmin read finds a membership row.
    const db = fakeDb([[], []]);
    expect(await requireSessionRole(db, 'sess-other', 9, 'guest-1', 'editor')).toBeNull();
  });

  it('cannot write a canvas above its board role', async () => {
    const db = fakeDb([[{ session: SESSION, role: 'commenter' }]]);
    expect(await requireSessionRole(db, 'sess-1', 9, 'guest-1', 'editor')).toBeNull();
  });

  it('holds no workspace write permission — tasks, projects and workflows stay developer+', () => {
    const perms = resolveRolePermissions(TenantRole.CONTRIBUTOR, []) as string[];
    for (const write of ['task:write', 'task:assign', 'project:write', 'workflow:write', 'workflow:execute']) {
      expect(perms).not.toContain(write);
    }
    // It reads the workspace like a viewer.
    expect(perms.sort()).toEqual((resolveRolePermissions(TenantRole.VIEWER, []) as string[]).sort());
  });

  it('clears no developer or manager route tier — runs, lanes, agents', () => {
    // `requireRole(DEVELOPER)` guards runtime dispatch and board lanes;
    // `requireRole(MANAGER)` guards agent create/delete. Both read `hasMinRole`.
    expect(hasMinRole(TenantRole.CONTRIBUTOR, TenantRole.DEVELOPER)).toBe(false);
    expect(hasMinRole(TenantRole.CONTRIBUTOR, TenantRole.MANAGER)).toBe(false);
    // …while every read tier (`requireRole(VIEWER)`) still admits it.
    expect(hasMinRole(TenantRole.CONTRIBUTOR, TenantRole.VIEWER)).toBe(true);
  });
});
