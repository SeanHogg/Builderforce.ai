import { describe, it, expect } from 'vitest';
import { TenantPlan } from '../shared/types';
import { evaluatePremiumModelAccess, premiumModelGateBody } from './planFeatures';

/**
 * PREMIUM model access — "may this tenant select ANY paid OpenRouter model?"
 *
 * Deliberately STRICTER than frontier access: premium routes on Builderforce's metered
 * OpenRouter key (billed at OpenRouter cost + a flat 1¢/request), so it needs a PAID
 * plan AND a validated card. These tests pin the two properties that protect revenue and
 * UX respectively: a card alone never unlocks it, and a paid tenant without a card is
 * told to validate (not to upgrade to a plan they already have).
 */
describe('evaluatePremiumModelAccess', () => {
  const base = {
    effectivePlan: TenantPlan.PRO,
    premiumOverride: false,
    isSuperadmin: false,
    cardValidated: true,
  };

  it('entitles a paid plan with a validated card', () => {
    expect(evaluatePremiumModelAccess(base)).toEqual({ entitled: true, reason: 'paid_card' });
  });

  it('entitles Teams the same as Pro', () => {
    expect(evaluatePremiumModelAccess({ ...base, effectivePlan: TenantPlan.TEAMS }).entitled).toBe(true);
  });

  it('blocks a paid plan with NO validated card, and asks for the card (not an upgrade)', () => {
    const access = evaluatePremiumModelAccess({ ...base, cardValidated: false });
    expect(access).toEqual({ entitled: false, reason: 'card_required', unlock: 'validate_card' });
  });

  it('blocks a free plan and asks for an upgrade — a card alone must NOT unlock premium', () => {
    const access = evaluatePremiumModelAccess({ ...base, effectivePlan: TenantPlan.FREE, cardValidated: true });
    expect(access).toEqual({ entitled: false, reason: 'plan_required', unlock: 'upgrade' });
  });

  it('blocks a free plan with no card', () => {
    expect(evaluatePremiumModelAccess({
      ...base, effectivePlan: TenantPlan.FREE, cardValidated: false,
    }).entitled).toBe(false);
  });

  // Bypasses — operators and comped/beta tenants never hit the wall, even with no card.
  it('superadmin bypasses plan AND card', () => {
    expect(evaluatePremiumModelAccess({
      effectivePlan: TenantPlan.FREE, premiumOverride: false, isSuperadmin: true, cardValidated: false,
    })).toEqual({ entitled: true, reason: 'superadmin' });
  });

  it('premium override bypasses plan AND card', () => {
    expect(evaluatePremiumModelAccess({
      effectivePlan: TenantPlan.FREE, premiumOverride: true, isSuperadmin: false, cardValidated: false,
    })).toEqual({ entitled: true, reason: 'premium_override' });
  });

  it('ranks superadmin above premium override', () => {
    expect(evaluatePremiumModelAccess({
      effectivePlan: TenantPlan.FREE, premiumOverride: true, isSuperadmin: true, cardValidated: false,
    }).reason).toBe('superadmin');
  });
});

describe('premiumModelGateBody', () => {
  it('tells a card-less paid tenant to validate — and does NOT sell them an upgrade', () => {
    const body = premiumModelGateBody({ entitled: false, reason: 'card_required', unlock: 'validate_card' });
    expect(body.code).toBe('premium_model_not_allowed');
    expect(body.unlock).toBe('validate_card');
    expect(body.upgrade).toBe(false);
    expect(body.error).toMatch(/validated card/i);
  });

  it('tells a free tenant to upgrade', () => {
    const body = premiumModelGateBody({ entitled: false, reason: 'plan_required', unlock: 'upgrade' });
    expect(body.unlock).toBe('upgrade');
    expect(body.upgrade).toBe(true);
    expect(body.requiredPlan).toBe(TenantPlan.PRO);
  });
});
