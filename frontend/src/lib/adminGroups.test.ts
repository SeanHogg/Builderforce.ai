import { describe, expect, it } from 'vitest';
import { adminSubHref, resolveAdminRoute } from './adminGroups';

describe('Creation Sessions super-admin route', () => {
  it('resolves the platform value dashboard in Overview', () => {
    const route = resolveAdminRoute('', '');
    expect(route.group.id).toBe('');
    expect(route.sub.subKey).toBe('outcomes');
    expect(adminSubHref(route.group.id, route.sub.id)).toBe('/admin');
  });

  it('resolves the canonical workspace subview', () => {
    const route = resolveAdminRoute('workspaces', 'creation-sessions');
    expect(route.group.id).toBe('workspaces');
    expect(route.sub.subKey).toBe('creationSessions');
    expect(adminSubHref(route.group.id, route.sub.id)).toBe('/admin?tab=workspaces&sub=creation-sessions');
  });

  it('keeps the legacy deep link working', () => {
    const route = resolveAdminRoute('creationSessions', '');
    expect(route.group.id).toBe('workspaces');
    expect(route.sub.id).toBe('creation-sessions');
  });
});
