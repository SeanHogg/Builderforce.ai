/**
 * A capability licence IS the entitlement (PRD 33 §4.2 step 3): a held live licence
 * for the platform's `session-replay` listing grants `sessionReplay`; a revoked one
 * grants nothing, and the change is seen on the next read (no TTL wait). The plan
 * snapshot and superadmin flag are mocked; the licence read runs over a fake db.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  heldRows: [] as Array<{ slug: string }>,
  selects: 0,
  isSuperadmin: false,
  premiumOverride: false,
}));

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: vi.fn(() => ({
    select: () => {
      mocks.selects += 1;
      const chain = { from: () => chain, innerJoin: () => chain, where: async () => mocks.heldRows };
      return chain;
    },
  })),
}));
vi.mock('./tenantPlanSnapshot', () => ({
  resolveTenantPlan: vi.fn(async () => ({ effectivePlan: 'free', premiumOverride: mocks.premiumOverride })),
}));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({
  resolveIsSuperadmin: vi.fn(async () => mocks.isSuperadmin),
}));

import type { Env } from '../../env';
import { capabilityLicenceChanged, heldCapabilityFeatures } from './heldCapabilities';
import { resolveFeatureEntitlement, tenantHasFeature } from './featureEntitlements';
import {
  CAPABILITY_FEATURES,
  capabilityForFeature,
  capabilityRequiredBody,
  featuresForCapabilities,
} from '../../domain/tenant/capabilityFeatures';

const env = {} as Env;

beforeEach(() => {
  mocks.heldRows = [];
  mocks.selects = 0;
  mocks.isSuperadmin = false;
  mocks.premiumOverride = false;
});

describe('CAPABILITY_FEATURES', () => {
  it('maps the Insights listing to sessionReplay, and back', () => {
    expect(CAPABILITY_FEATURES['session-replay']).toEqual(['sessionReplay']);
    expect(featuresForCapabilities(['session-replay', 'unknown', 'session-replay'])).toEqual(['sessionReplay']);
    expect(capabilityForFeature('sessionReplay')).toBe('session-replay');
    expect(capabilityForFeature('voiceCloning')).toBeNull();
  });

  it('refuses with an install body, not an upgrade wall', () => {
    expect(capabilityRequiredBody('sessionReplay', 'Insights')).toEqual({
      error: 'Install it from the Marketplace to unlock Insights.',
      code: 'capability_required',
      feature: 'sessionReplay',
      capability: 'session-replay',
      installRequired: true,
    });
  });
});

describe('held capability licences → sessionReplay', () => {
  it('a held live licence entitles the workspace', async () => {
    mocks.heldRows = [{ slug: 'session-replay' }];
    expect(await heldCapabilityFeatures(env, undefined, 7)).toEqual(['sessionReplay']);
    const verdict = await resolveFeatureEntitlement(env, 7, 'u1', 'sessionReplay');
    expect(verdict).toMatchObject({ entitled: true, reason: 'capability', capability: 'session-replay' });
  });

  it('no live licence (never installed, or revoked) entitles nothing', async () => {
    mocks.heldRows = [];
    expect(await heldCapabilityFeatures(env, undefined, 7)).toEqual([]);
    const verdict = await resolveFeatureEntitlement(env, 7, 'u1', 'sessionReplay');
    expect(verdict).toMatchObject({ entitled: false, reason: 'not_entitled', capability: 'session-replay' });
  });

  it('a revoke is seen on the next read once the licence writer calls capabilityLicenceChanged', async () => {
    mocks.heldRows = [{ slug: 'session-replay' }];
    expect(await tenantHasFeature(env, 7, null, 'sessionReplay')).toBe(true);
    mocks.heldRows = [];
    // Still the cached answer until the writer invalidates…
    expect(await tenantHasFeature(env, 7, null, 'sessionReplay')).toBe(true);
    await capabilityLicenceChanged(env, 7);
    expect(await tenantHasFeature(env, 7, null, 'sessionReplay')).toBe(false);
  });

  it('superadmins stay entitled without a licence', async () => {
    mocks.isSuperadmin = true;
    expect(await resolveFeatureEntitlement(env, 7, 'op', 'sessionReplay')).toMatchObject({ entitled: true, reason: 'superadmin' });
  });

  it('a comped premium override does not install a capability', async () => {
    mocks.premiumOverride = true;
    expect(await resolveFeatureEntitlement(env, 7, 'u1', 'sessionReplay')).toMatchObject({ entitled: false });
    // …while it still comps a plan feature.
    expect(await resolveFeatureEntitlement(env, 7, 'u1', 'voiceCloning')).toMatchObject({ entitled: true, reason: 'premium_override' });
  });

  it('never reads licences for a plan feature', async () => {
    await resolveFeatureEntitlement(env, 7, 'u1', 'voiceCloning');
    expect(mocks.selects).toBe(0);
  });
});
