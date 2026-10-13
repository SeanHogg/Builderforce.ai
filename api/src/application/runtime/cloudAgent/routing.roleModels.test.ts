import { describe, expect, it } from 'vitest';
import { pickCloudModel } from '../../llm/LlmProxyService';
import { vendorFlagship } from '../../llm/vendors';
import { ROLE_MODEL_DEFAULT_ENV, ROLE_MODELS_ENV } from '@builderforce/learned-routing';
import { cloudRunRoleForModelPin, requestedModelForRole } from './routing';

/** A real catalog coder so pickCloudModel can strict-pin it on a paid plan. */
const PIN = vendorFlagship('anthropic', false)!;
const OTHER = vendorFlagship('anthropic', true)!;

describe('cloudRunRoleForModelPin', () => {
  it('uses spawn / call-purpose role first', () => {
    expect(cloudRunRoleForModelPin({ spawnRole: 'verify', deliveryRole: 'developer' })).toBe('verify');
  });

  it('falls through to board delivery role, then the parent loop\'s code', () => {
    expect(cloudRunRoleForModelPin({ deliveryRole: 'qa-tester' })).toBe('qa-tester');
    expect(cloudRunRoleForModelPin({})).toBe('code');
    expect(cloudRunRoleForModelPin({ spawnRole: '  ', deliveryRole: '  ' })).toBe('code');
  });
});

describe('requestedModelForRole', () => {
  const env = {
    [ROLE_MODELS_ENV]: '{"verify":"' + PIN + '","developer":"' + PIN + '"}',
    [ROLE_MODEL_DEFAULT_ENV]: OTHER,
  };

  it('no ROLE_MODELS ⇒ undefined (existing behaviour)', () => {
    expect(requestedModelForRole(undefined, 'code')).toBeUndefined();
    expect(requestedModelForRole({}, 'code')).toBeUndefined();
    expect(requestedModelForRole({ [ROLE_MODELS_ENV]: 'not-json' }, 'verify')).toBeUndefined();
  });

  it('ROLE_MODELS pin for the run role, ROLE_MODEL_DEFAULT for an unmapped role', () => {
    expect(requestedModelForRole(env, 'verify')).toBe(PIN);
    expect(requestedModelForRole(env, 'developer')).toBe(PIN);
    expect(requestedModelForRole(env, 'code')).toBe(OTHER);
    expect(requestedModelForRole(env, undefined)).toBe(OTHER);
  });

  it('explicit user/run model still wins', () => {
    expect(requestedModelForRole(env, 'verify', OTHER)).toBe(OTHER);
    expect(requestedModelForRole(env, 'verify', '  ')).toBe(PIN);
  });
});

describe('ROLE_MODELS pin vs pickCloudModel learned / plan seed', () => {
  it('a catalog ROLE_MODELS pin is preferred as the requested model (strict) before the plan seed', () => {
    const requested = requestedModelForRole(
      { [ROLE_MODELS_ENV]: JSON.stringify({ verify: PIN }) },
      'verify',
    );
    expect(requested).toBe(PIN);
    const pick = pickCloudModel(requested, 'pro', false, {
      premiumEntitled: true,
      // Would reorder the soft seed if the pin were absent — must not win.
      actionType: 'bugfix',
      actionStats: [{ model: OTHER, n: 40, avgScore: 0.95, avgCostMc: 1 }],
    });
    expect(pick.strict).toBe(true);
    expect(pick.model).toBe(PIN);
  });

  it('no pin leaves pickCloudModel on the plan coding seed (not strict)', () => {
    const requested = requestedModelForRole({}, 'code');
    expect(requested).toBeUndefined();
    const pick = pickCloudModel(requested, 'pro', false, { premiumEntitled: true });
    expect(pick.strict).toBe(false);
    expect(pick.model).toBeTruthy();
  });
});
