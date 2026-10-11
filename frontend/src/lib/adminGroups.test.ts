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

describe('Growth ▸ Visitors consolidation', () => {
  it('resolves the canonical visitors subview', () => {
    const route = resolveAdminRoute('growth', 'visitors');
    expect(route.group.id).toBe('growth');
    expect(route.sub.subKey).toBe('visitors');
    expect(adminSubHref(route.group.id, route.sub.id)).toBe('/admin?tab=growth&sub=visitors');
  });

  it('aliases the old visitor-flow sub onto visitors', () => {
    const route = resolveAdminRoute('growth', 'visitorFlow');
    expect(route.group.id).toBe('growth');
    expect(route.sub.id).toBe('visitors');
  });

  it('aliases Users ▸ Sessions onto Growth ▸ Visitors', () => {
    const route = resolveAdminRoute('users', 'sessions');
    expect(route.group.id).toBe('growth');
    expect(route.sub.id).toBe('visitors');
  });

  it('keeps the legacy top-level visitorFlow and sessions tabs working', () => {
    expect(resolveAdminRoute('visitorFlow', '').sub.id).toBe('visitors');
    expect(resolveAdminRoute('sessions', '').group.id).toBe('growth');
    expect(resolveAdminRoute('sessions', '').sub.id).toBe('visitors');
  });
});
