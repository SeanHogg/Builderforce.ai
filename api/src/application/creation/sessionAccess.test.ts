import { describe, expect, it } from 'vitest';
import { SESSION_ROLE_RANK, tenantRoleForSessionRole, type SessionRole } from './sessionAccess';
import { TenantRole, hasMinRole } from '../../domain/shared/types';

describe('tenantRoleForSessionRole', () => {
  it('gives a board viewer or commenter no more than workspace viewer', () => {
    // Sharing one canvas granted `developer` on the whole workspace — write
    // access to every project, ticket and agent in it — regardless of the board
    // role. The board role is the ceiling.
    expect(tenantRoleForSessionRole('viewer')).toBe(TenantRole.VIEWER);
    expect(tenantRoleForSessionRole('commenter')).toBe(TenantRole.VIEWER);
  });

  it('seats a role that edits or runs the board as a contributor, never a developer', () => {
    // Operator decision 2026-09-12: the edit grant is the BOARD role. The
    // workspace seat only lets the board resolve, so it must not carry the
    // `developer` tier that writes tasks, projects and agents.
    expect(tenantRoleForSessionRole('editor')).toBe(TenantRole.CONTRIBUTOR);
    expect(tenantRoleForSessionRole('runner')).toBe(TenantRole.CONTRIBUTOR);
    expect(tenantRoleForSessionRole('owner')).toBe(TenantRole.CONTRIBUTOR);
  });

  it('answers for every board role there is, and never above contributor', () => {
    for (const role of Object.keys(SESSION_ROLE_RANK) as SessionRole[]) {
      const seated = tenantRoleForSessionRole(role);
      expect([TenantRole.VIEWER, TenantRole.CONTRIBUTOR]).toContain(seated);
      expect(hasMinRole(seated, TenantRole.DEVELOPER)).toBe(false);
    }
  });
});
