/**
 * PRD 25 A6 — the install button's target key.
 *
 * Two rules collide here: a marketplace template key may only carry
 * `[a-z0-9-]`, while a sector id is snake_case (`climate_energy`). The API's
 * catalogue rejects an underscore key outright, so a frontend that interpolates
 * the sector verbatim renders an "Install" button pointing at a template that
 * cannot exist — the empty-state CTA, dead, for exactly the two verticals whose
 * ids are compound.
 */

import { describe, it, expect } from 'vitest';
import { DASHBOARD_VERTICALS } from '@builderforce/creation-canvas-contract';
import { dashboardTemplateKey } from './FinanceDashboardView';

describe('dashboardTemplateKey', () => {
  it('hyphenates a compound sector id', () => {
    expect(dashboardTemplateKey('climate_energy')).toBe('vertical-dashboard-climate-energy');
    expect(dashboardTemplateKey('hardware_robotics')).toBe('vertical-dashboard-hardware-robotics');
  });

  it('falls back to the founder dashboard when the sector maps to no vertical', () => {
    // verticalForSector returns null for sectors with no cohort of their own;
    // those founders still get a dashboard rather than an empty tab.
    expect(dashboardTemplateKey(null)).toBe('vertical-dashboard-founder');
  });

  it('produces a legal template key for every shipped vertical', () => {
    for (const sector of DASHBOARD_VERTICALS) {
      expect(dashboardTemplateKey(sector)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });
});
