import { describe, expect, it } from 'vitest';
import { STARTUP_SECTORS } from './startupListing';
import { DASHBOARD_VERTICALS, isDashboardVertical, verticalForSector } from './verticals';

describe('dashboard verticals', () => {
  it('every vertical is a sector, and there are exactly ten', () => {
    expect(DASHBOARD_VERTICALS).toHaveLength(10);
    for (const v of DASHBOARD_VERTICALS) expect(STARTUP_SECTORS).toContain(v);
  });

  it('every sector resolves — to itself, to a fold, or to the founder layer', () => {
    for (const s of STARTUP_SECTORS) {
      const v = verticalForSector(s);
      expect(v === null || isDashboardVertical(v)).toBe(true);
      if (isDashboardVertical(s)) expect(v).toBe(s);
    }
  });

  it('folds commerce onto marketplace and enterprise software onto saas', () => {
    expect(verticalForSector('ecommerce')).toBe('marketplace');
    expect(verticalForSector('consumer_apps')).toBe('marketplace');
    expect(verticalForSector('enterprise_software')).toBe('saas');
  });

  it('an unknown or empty sector is the founder layer alone', () => {
    expect(verticalForSector(null)).toBeNull();
    expect(verticalForSector('')).toBeNull();
    expect(verticalForSector('software_saas')).toBeNull();
    expect(verticalForSector('other')).toBeNull();
  });
});
