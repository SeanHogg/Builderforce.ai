import { describe, it, expect } from 'vitest';
import { itemsFor } from './MobileBottomNav';

const hrefs = (items: ReturnType<typeof itemsFor>) => items.map((i) => i.href);

describe('MobileBottomNav itemsFor (role-aware) [1335]', () => {
  it('logged-out bar always has 5 items ending in an accented Sign In', () => {
    const items = itemsFor(false, false);
    expect(items).toHaveLength(5);
    expect(items[0]?.href).toBe('/');
    expect(items[4]?.href).toBe('/login');
    // Sign In is the only accented (CTA-styled) item — drives .mbn-accent.
    expect(items[4]?.accent).toBe(true);
    expect(items.filter((i) => i.accent)).toHaveLength(1);
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

  it('a freelancer (job seeker) gets the restricted for-hire destinations, not the builder app', () => {
    const items = itemsFor(true, false, undefined, true);
    expect(hrefs(items)).toEqual([
      '/freelancer/dashboard',
      '/freelancer/gigs',
      '/freelancer/timecard',
      '/freelancer/profile',
      '/security',
    ]);
    // No builder destinations leak in, and no CTA accent in-app.
    expect(items.some((i) => i.href.startsWith('/workforce') || i.href === '/admin')).toBe(false);
    expect(items.some((i) => i.accent)).toBe(false);
  });

  it('freelancer flag overrides superadmin/role (account type wins the shell split)', () => {
    // Even a superadmin freelancer stays in the for-hire shell — no Admin slot.
    expect(hrefs(itemsFor(true, true, 'owner', true))).not.toContain('/admin');
  });
});
