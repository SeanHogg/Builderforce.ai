import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from './adminApi';

describe('adminApi.effectivePermissions', () => {
  beforeEach(() => {
    localStorage.setItem('bf_web_token', 'test-token');
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('normalizes the legacy API field used by deployed workers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      role: 'developer',
      rolePermissions: ['project:read'],
      modulePermissions: ['agent:run'],
      userGrants: ['project:write'],
      userRevocations: [],
      effectivePermissions: ['project:read', 'agent:run', 'project:write'],
    }), { status: 200 })));

    await expect(adminApi.effectivePermissions('user-1', 42)).resolves.toEqual({
      userId: 'user-1',
      tenantId: 42,
      role: 'developer',
      permissions: ['project:read', 'agent:run', 'project:write'],
      rolePermissions: ['project:read'],
      modulePermissions: ['agent:run'],
      userGrants: ['project:write'],
      userRevocations: [],
    });
  });

  it('defaults missing collection fields to empty arrays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      userId: 'user-2',
      tenantId: 7,
      role: 'viewer',
      permissions: ['project:read'],
    }), { status: 200 })));

    await expect(adminApi.effectivePermissions('user-2', 7)).resolves.toMatchObject({
      permissions: ['project:read'],
      rolePermissions: [],
      modulePermissions: [],
      userGrants: [],
      userRevocations: [],
    });
  });
});
