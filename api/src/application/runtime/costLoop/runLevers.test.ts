import { describe, expect, it } from 'vitest';
import { pickCloudModel } from '../../llm/pickCloudModel';
import { cloudOutputCap, cloudReasoningExecParams, cloudRoutingExploration, toolRowCodecOptions } from './runLevers';

const OFF = { COST_LEVERS_ALL: 'off' };

describe('run levers — off reproduces the pre-lever request', () => {
  it('no exploration, the explicit reasoning levers, the caller cap, plain tool rows', () => {
    expect(cloudRoutingExploration(OFF, 7)).toBeUndefined();
    expect(cloudReasoningExecParams(OFF, 7, undefined, 'explore')).toBeUndefined();
    expect(cloudReasoningExecParams(OFF, 7, { temperature: 0.2 }, 'plan')).toEqual({ temperature: 0.2 });
    expect(cloudOutputCap(OFF, 7, 'code', undefined)).toBeUndefined();
    expect(cloudOutputCap(OFF, 7, 'code', 20_000)).toBe(20_000);
    expect(toolRowCodecOptions(OFF, 7)).toBeUndefined();
  });
});

describe('run levers — on', () => {
  it('D3: hands the ranker a random source', () => {
    const explore = cloudRoutingExploration({ COST_LEVER_D3_ROUTING_EXPLORATION: 'on' }, 7);
    expect(typeof explore?.rng).toBe('function');
  });

  it('D4: the role default fills in only when the persona chose no effort', () => {
    const env = { COST_LEVER_D4_ROLE_REASONING: 'on' };
    expect(cloudReasoningExecParams(env, 7, undefined, 'explore')).toEqual({ thinkLevel: 'minimal' });
    expect(cloudReasoningExecParams(env, 7, { temperature: 0.2 }, 'plan')).toEqual({ temperature: 0.2, thinkLevel: 'high' });
    expect(cloudReasoningExecParams(env, 7, { thinkLevel: 'low' }, 'plan')).toEqual({ thinkLevel: 'low' });
  });

  it('D5: caps by role, keeping a lower caller value', () => {
    const env = { COST_LEVER_D5_OUTPUT_CAPS: 'on' };
    expect(cloudOutputCap(env, 7, 'code', undefined)).toBe(8_192);
    expect(cloudOutputCap(env, 7, 'code', 1_000)).toBe(1_000);
  });

  it('C7: tool rows go through the shared policy', () => {
    const opts = toolRowCodecOptions({ COST_LEVER_C7_TOOL_OUTPUT_POLICY: 'on' }, 7);
    expect(opts?.toolResultPolicy?.('list_files', { ok: true })).toBe('{"ok":true}');
  });
});

describe('pickCloudModel — D3 exploration reaches only the soft seed', () => {
  // rng 0 always takes the cold slot (5% share) and picks its first candidate.
  const explore = { rng: () => 0 };
  const pool = pickCloudModel(undefined, 'pro').ranked ?? [];
  const proven = pool[0]!;
  const actionStats = [{ model: proven, n: 50, avgScore: 0.95, avgCostMc: 10 }];

  it('without exploration the proven model leads', () => {
    expect(pool.length).toBeGreaterThan(1);
    expect(pickCloudModel(undefined, 'pro', false, { actionStats }).model).toBe(proven);
  });

  it('with exploration a cold model can take the lead', () => {
    expect(pickCloudModel(undefined, 'pro', false, { actionStats, explore }).model).not.toBe(proven);
  });

  it('a premium override never explores', () => {
    const plain = pickCloudModel(undefined, 'pro', true, { actionStats });
    expect(pickCloudModel(undefined, 'pro', true, { actionStats, explore }).model).toBe(plain.model);
  });

  it('a strict pin is untouched', () => {
    expect(pickCloudModel('openai/gpt-4.1', 'pro', false, { actionStats, explore })).toEqual({ model: 'openai/gpt-4.1', strict: true });
  });
});
