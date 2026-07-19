import { describe, expect, it } from 'vitest';
import {
  evaluateFeatureEntitlement,
  evaluateFrontierAccess,
  requiredPlanForFeature,
  PLAN_FEATURE_LABEL,
  type PlanFeature,
} from './planFeatures';
import { TenantPlan } from '../shared/types';

const ALL_FEATURES = Object.keys(PLAN_FEATURE_LABEL) as PlanFeature[];

describe('planFeatures — requiredPlanForFeature is derived from PLAN_LIMITS', () => {
  it('psychometric personas unlock at Pro', () => {
    expect(requiredPlanForFeature('psychometricPersona')).toBe(TenantPlan.PRO);
  });

  it('team-only features unlock at Teams', () => {
    expect(requiredPlanForFeature('teamApprovalInbox')).toBe(TenantPlan.TEAMS);
    expect(requiredPlanForFeature('seatCostControls')).toBe(TenantPlan.TEAMS);
  });

  it('voice cloning is a paid feature unlocking at Pro', () => {
    expect(requiredPlanForFeature('voiceCloning')).toBe(TenantPlan.PRO);
  });

  it('every feature has a human label', () => {
    for (const f of ALL_FEATURES) {
      expect(PLAN_FEATURE_LABEL[f]).toBeTruthy();
    }
  });
});

describe('evaluateFeatureEntitlement — one verdict, applied consistently', () => {
  const base = {
    feature: 'psychometricPersona' as PlanFeature,
    effectivePlan: TenantPlan.FREE,
    premiumOverride: false,
    isSuperadmin: false,
  };

  it('free plan without override is NOT entitled, and advertises the required plan', () => {
    const r = evaluateFeatureEntitlement(base);
    expect(r.entitled).toBe(false);
    expect(r.reason).toBe('not_entitled');
    expect(r.requiredPlan).toBe(TenantPlan.PRO);
    expect(r.currentPlan).toBe(TenantPlan.FREE);
  });

  it('paid plan is entitled via the plan grant', () => {
    const r = evaluateFeatureEntitlement({ ...base, effectivePlan: TenantPlan.PRO });
    expect(r.entitled).toBe(true);
    expect(r.reason).toBe('plan');
  });

  it('a superadmin on a free plan is entitled (bypass) — never sees an upgrade wall', () => {
    const r = evaluateFeatureEntitlement({ ...base, isSuperadmin: true });
    expect(r.entitled).toBe(true);
    expect(r.reason).toBe('superadmin');
  });

  it('a comped premium-override tenant is entitled even on free', () => {
    const r = evaluateFeatureEntitlement({ ...base, premiumOverride: true });
    expect(r.entitled).toBe(true);
    expect(r.reason).toBe('premium_override');
  });

  it('superadmin takes precedence over plan (order-independent bypass)', () => {
    const r = evaluateFeatureEntitlement({ ...base, isSuperadmin: true, effectivePlan: TenantPlan.TEAMS });
    expect(r.entitled).toBe(true);
    expect(r.reason).toBe('superadmin');
  });

  it('a Teams-only feature is not granted by Pro', () => {
    const r = evaluateFeatureEntitlement({
      feature: 'teamApprovalInbox',
      effectivePlan: TenantPlan.PRO,
      premiumOverride: false,
      isSuperadmin: false,
    });
    expect(r.entitled).toBe(false);
    expect(r.requiredPlan).toBe(TenantPlan.TEAMS);
  });
});

describe('evaluateFrontierAccess — plan OR superadmin OR premium OR BYO unlocks frontier', () => {
  const base = { effectivePlan: TenantPlan.FREE, premiumOverride: false, isSuperadmin: false, hasConnectedByoFrontier: false };

  it('free plan, nothing connected → NOT entitled', () => {
    expect(evaluateFrontierAccess(base)).toEqual({ entitled: false, reason: 'not_entitled' });
  });

  it('a paid plan unlocks frontier', () => {
    expect(evaluateFrontierAccess({ ...base, effectivePlan: TenantPlan.PRO })).toEqual({ entitled: true, reason: 'paid_plan' });
  });

  it('a SUPERADMIN on free with no connected account still gets frontier (the reported gap)', () => {
    expect(evaluateFrontierAccess({ ...base, isSuperadmin: true })).toEqual({ entitled: true, reason: 'superadmin' });
  });

  it('a connected BYO account unlocks frontier on the FREE plan (own tokens fund it — the reported gap)', () => {
    expect(evaluateFrontierAccess({ ...base, hasConnectedByoFrontier: true })).toEqual({ entitled: true, reason: 'byo_connected' });
  });

  it('a comped premium override unlocks frontier on free', () => {
    expect(evaluateFrontierAccess({ ...base, premiumOverride: true })).toEqual({ entitled: true, reason: 'premium_override' });
  });

  it('superadmin takes precedence over BYO/premium/plan (stable reason ordering)', () => {
    expect(evaluateFrontierAccess({ effectivePlan: TenantPlan.TEAMS, premiumOverride: true, isSuperadmin: true, hasConnectedByoFrontier: true }))
      .toEqual({ entitled: true, reason: 'superadmin' });
  });
});
