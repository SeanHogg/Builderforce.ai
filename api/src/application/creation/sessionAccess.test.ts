import { describe, expect, it } from 'vitest';
import { SESSION_ROLE_RANK, tenantRoleForSessionRole, type SessionRole } from './sessionAccess';
import { TenantRole } from '../../domain/shared/types';

describe('tenantRoleForSessionRole', () => {
  it('gives a board viewer or commenter no more than workspace viewer', () => {
    // Sharing one canvas granted `developer` on the whole workspace — write
    // access to every project, ticket and agent in it — regardless of the board
    // role. The board role is the ceiling.
    expect(tenantRoleForSessionRole('viewer')).toBe(TenantRole.VIEWER);
    expect(tenantRoleForSessionRole('commenter')).toBe(TenantRole.VIEWER);
  });

  it('gives a role that edits or runs the board the developer access those paths need', () => {
    expect(tenantRoleForSessionRole('editor')).toBe(TenantRole.DEVELOPER);
    expect(tenantRoleForSessionRole('runner')).toBe(TenantRole.DEVELOPER);
    expect(tenantRoleForSessionRole('owner')).toBe(TenantRole.DEVELOPER);
  });

  it('answers for every board role there is', () => {
    for (const role of Object.keys(SESSION_ROLE_RANK) as SessionRole[]) {
      expect([TenantRole.VIEWER, TenantRole.DEVELOPER]).toContain(tenantRoleForSessionRole(role));
    }
  });
});
