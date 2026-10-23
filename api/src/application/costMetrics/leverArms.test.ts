import { describe, expect, it } from 'vitest';
import { COST_LEVERS, isCostLeverOn } from '@builderforce/cost-levers';
import { costLeverArmsStamp } from './leverArms';

describe('costLeverArmsStamp', () => {
  it('stamps only partially rolled-out levers, each in exactly one arm', () => {
    const stamp = costLeverArmsStamp({}, 42)!;
    const partial = COST_LEVERS.filter((l) => l.rollout > 0 && l.rollout < 100).map((l) => l.id);
    expect([...stamp.on, ...stamp.off].sort()).toEqual([...partial].sort());
    for (const id of stamp.on) expect(isCostLeverOn({}, id, 42)).toBe(true);
    for (const id of stamp.off) expect(isCostLeverOn({}, id, 42)).toBe(false);
  });

  it('drops a lever forced fully on or off by env — it has no control group', () => {
    const stamp = costLeverArmsStamp({ COST_LEVER_C1_DEFERRED_TOOLS: 'on', COST_LEVER_C2_OBSERVATION_MASKING: 'off' }, 42)!;
    expect([...stamp.on, ...stamp.off]).not.toContain('c1_deferred_tools');
    expect([...stamp.on, ...stamp.off]).not.toContain('c2_observation_masking');
  });

  it('is null when nothing is partial (global kill switch)', () => {
    expect(costLeverArmsStamp({ COST_LEVERS_ALL: 'off' }, 42)).toBeNull();
  });

  it('puts a tenant-less row in the off arm of every partial lever', () => {
    const stamp = costLeverArmsStamp({}, null)!;
    expect(stamp.on).toEqual([]);
    expect(stamp.off.length).toBeGreaterThan(0);
  });
});
