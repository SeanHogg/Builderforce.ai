import { describe, it, expect } from 'vitest';
import { itemsFor } from './MobileBottomNav';

const hrefs = (items: ReturnType<typeof itemsFor>) => items.map((i) => i.href);

describe('MobileBottomNav itemsFor (role-aware) [1335]', () => {
  it('logged-out bar always has 5 items ending in Sign In', () => {
    const items = itemsFor(false, false);
    expect(items).toHaveLength(5);
    expect(items[0]?.href).toBe('/');
    expect(items[4]?.href).toBe('/login');
  });

  it('superadmin gets Admin in the last slot regardless of role', () => {
    expect(hrefs(itemsFor(true, true, 'developer'))[4]).toBe('/admin');
    expect(hrefs(itemsFor(true, true, 'owner'))[4]).toBe('/admin');
  });

  it('owner/manager get Settings; developer/viewer get Projects', () => {
    expect(hrefs(itemsFor(true, false, 'owner'))[4]).toBe('/settings');
    expect(hrefs(itemsFor(true, false, 'manager'))[4]).toBe('/settings');
    expect(hrefs(itemsFor(true, false, 'developer'))[4]).toBe('/projects');
    expect(hrefs(itemsFor(true, false, 'viewer'))[4]).toBe('/projects');
  });

  it('unknown/absent role defaults to the contributor (Projects) slot', () => {
    expect(hrefs(itemsFor(true, false, undefined))[4]).toBe('/projects');
  });

  it('always renders exactly 5 items when authenticated', () => {
    expect(itemsFor(true, false, 'owner')).toHaveLength(5);
    expect(itemsFor(true, false, 'developer')).toHaveLength(5);
  });
});
