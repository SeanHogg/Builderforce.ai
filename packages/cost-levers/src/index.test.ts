import { describe, expect, it } from 'vitest';
import { COST_LEVERS, costLeverArms, costLeverBucket, costLeverEnvKey, costLeverRollout, isCostLeverOn } from './index';

describe('cost levers', () => {
  it('derives the env key from the id', () => {
    expect(costLeverEnvKey('c2_observation_masking')).toBe('COST_LEVER_C2_OBSERVATION_MASKING');
  });

  it('uses the manifest default when env is silent', () => {
    expect(costLeverRollout({}, 'b1_stable_prefix')).toBe(100);
    expect(costLeverRollout({}, 'c2_observation_masking')).toBe(10);
  });

  it('env on/off/percent overrides the default', () => {
    expect(costLeverRollout({ COST_LEVER_C8_TOKEN_COMPRESSION: 'on' }, 'c8_token_compression')).toBe(100);
    expect(costLeverRollout({ COST_LEVER_B1_STABLE_PREFIX: 'off' }, 'b1_stable_prefix')).toBe(0);
    expect(costLeverRollout({ COST_LEVER_C2_OBSERVATION_MASKING: '50' }, 'c2_observation_masking')).toBe(50);
    expect(costLeverRollout({ COST_LEVER_C2_OBSERVATION_MASKING: '250' }, 'c2_observation_masking')).toBe(100);
  });

  it('global kill switch turns every lever off unless a lever is set explicitly', () => {
    expect(isCostLeverOn({ COST_LEVERS_ALL: 'off' }, 'b1_stable_prefix', 't1')).toBe(false);
    expect(isCostLeverOn({ COST_LEVERS_ALL: 'off', COST_LEVER_B1_STABLE_PREFIX: 'on' }, 'b1_stable_prefix', 't1')).toBe(true);
  });

  it('buckets are stable and a partial rollout covers about its share', () => {
    expect(costLeverBucket('c2_observation_masking', 'tenant-42')).toBe(costLeverBucket('c2_observation_masking', 'tenant-42'));
    let on = 0;
    for (let i = 0; i < 2000; i++) if (isCostLeverOn({ COST_LEVER_C2_OBSERVATION_MASKING: '30' }, 'c2_observation_masking', `t${i}`)) on++;
    expect(on / 2000).toBeGreaterThan(0.25);
    expect(on / 2000).toBeLessThan(0.35);
  });

  it('a partial rollout is off without a tenant', () => {
    expect(isCostLeverOn({ COST_LEVER_C2_OBSERVATION_MASKING: '99' }, 'c2_observation_masking', null)).toBe(false);
    expect(isCostLeverOn({}, 'b1_stable_prefix', null)).toBe(true);
  });

  it('lists the arms a tenant is in', () => {
    const arms = costLeverArms({ COST_LEVERS_ALL: 'off', COST_LEVER_D3_ROUTING_EXPLORATION: 'on' }, 't1');
    expect(arms).toEqual(['d3_routing_exploration']);
    expect(new Set(COST_LEVERS.map((l) => l.id)).size).toBe(COST_LEVERS.length);
  });
});
