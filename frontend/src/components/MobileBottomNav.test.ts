import { describe, it, expect } from 'vitest';
// The item table moved into the registry (PRD 21 §11.7.1 caught it as a
// fifth list of hrefs and labels); the component is now only its renderer.
import { bottomNavFor as itemsFor } from '@/lib/navGroups';

const hrefs = (items: ReturnType<typeof itemsFor>) => items.map((i) => i.href);

describe('MobileBottomNav itemsFor (account-type + privilege aware)', () => {
  it('logged-out bar always has 5 items ending in an accented Sign In', () => {
    const items = itemsFor(false, false);
    expect(items).toHaveLength(5);
    expect(items[0]?.href).toBe('/');
    expect(items[4]?.href).toBe('/login');
    // Sign In is the only accented (CTA-styled) item — drives .mbn-accent.
    expect(items[4]?.accent).toBe(true);
    expect(items.filter((i) => i.accent)).toHaveLength(1);
  });

  // The canvas leads, not `/dashboard`: PRD 21 §6.8 lands sign-in on the last
  // board, and a Home slot pointing at the dashboard is what undoes that.
  it('builder (IDE creator) bar is Canvas / Projects / Workforce / Insights / account slot', () => {
    expect(hrefs(itemsFor(true, false))).toEqual([
      '/create',
      '/projects',
      '/workforce',
      '/insights',
      '/settings',
    ]);
  });

  it('superadmin builder gets Admin in the final slot instead of Settings', () => {
    expect(hrefs(itemsFor(true, true))[4]).toBe('/admin');
  });

  it('non-superadmin builder gets their account Settings in the final slot', () => {
    expect(hrefs(itemsFor(true, false))[4]).toBe('/settings');
  });

  it('job seeker (freelancer) bar is Home / Profile / Marketplace / Timecard / account slot', () => {
    const items = itemsFor(true, false, true);
    expect(hrefs(items)).toEqual([
      '/freelancer/dashboard',
      '/freelancer/profile',
      '/marketplace',
      '/freelancer/timecard',
      '/settings',
    ]);
    // No builder work destinations leak into the for-hire shell, and no CTA accent in-app.
    expect(items.some((i) => i.href === '/workforce' || i.href === '/insights' || i.href === '/projects')).toBe(false);
    expect(items.some((i) => i.accent)).toBe(false);
  });

  it('a superadmin freelancer still gets Admin in the final slot', () => {
    expect(hrefs(itemsFor(true, true, true))[4]).toBe('/admin');
  });

  it('always renders exactly 5 items when authenticated', () => {
    expect(itemsFor(true, false)).toHaveLength(5);
    expect(itemsFor(true, true)).toHaveLength(5);
    expect(itemsFor(true, false, true)).toHaveLength(5);
  });
});
