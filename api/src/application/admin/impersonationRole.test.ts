import { describe, expect, it } from 'vitest';
import { capImpersonationRole } from './impersonationRole';
import { TenantRole } from '../../domain/shared/types';

describe('capImpersonationRole', () => {
  it('refuses a role the ladder does not know instead of signing it', () => {
    const res = capImpersonationRole('superuser', 'owner');
    expect(res).toEqual({ ok: false, status: 400, error: "Unknown role 'superuser'" });
  });

  it('refuses a role above the target user\'s own', () => {
    expect(capImpersonationRole('owner', 'viewer')).toMatchObject({ ok: false, status: 403 });
    expect(capImpersonationRole('developer', 'contributor')).toMatchObject({ ok: false, status: 403 });
  });

  it('allows previewing the target at their own role or any lower one', () => {
    expect(capImpersonationRole('manager', 'manager')).toEqual({ ok: true, role: TenantRole.MANAGER });
    expect(capImpersonationRole('contributor', 'owner')).toEqual({ ok: true, role: TenantRole.CONTRIBUTOR });
    expect(capImpersonationRole('viewer', 'developer')).toEqual({ ok: true, role: TenantRole.VIEWER });
  });

  it('defaults an absent role to the target\'s own', () => {
    expect(capImpersonationRole(undefined, 'developer')).toEqual({ ok: true, role: TenantRole.DEVELOPER });
    expect(capImpersonationRole('   ', 'manager')).toEqual({ ok: true, role: TenantRole.MANAGER });
  });

  it('lets a non-member be previewed only as a viewer', () => {
    expect(capImpersonationRole(null, null)).toEqual({ ok: true, role: TenantRole.VIEWER });
    expect(capImpersonationRole('developer', null)).toMatchObject({ ok: false, status: 403 });
  });
});
