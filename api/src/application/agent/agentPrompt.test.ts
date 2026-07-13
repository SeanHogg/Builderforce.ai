import { describe, it, expect } from 'vitest';
import { agentMemorySignal, lowerAgentSpec, type AgentSpec } from '@builderforce/agent-tools';
import { buildAgentSystemPrompt, buildAgentInference, type AgentDescriptor } from './agentPrompt';

describe('lowerAgentSpec (canonical lowering)', () => {
  const base: AgentSpec = { identity: { name: 'Ada', title: 'Support Agent', bio: 'Answers billing questions.' } };

  it('renders identity + skills', () => {
    const out = lowerAgentSpec({ ...base, identity: { ...base.identity, skills: ['billing', 'refunds'] } });
    expect(out.systemPrompt).toBe('You are Ada, Support Agent. Answers billing questions.\n\nSkills: billing, refunds');
    expect(out.execParams).toEqual({});
    expect(out.model).toBeUndefined();
  });

  it('omits the skills line when there are no skills', () => {
    expect(lowerAgentSpec(base).systemPrompt).toBe('You are Ada, Support Agent. Answers billing questions.');
  });

  it('omits title/bio cleanly when absent (no dangling comma/period)', () => {
    expect(lowerAgentSpec({ identity: { name: 'Bot' } }).systemPrompt).toBe('You are Bot.');
  });

  it('renders persona directives as a personality block', () => {
    const out = lowerAgentSpec({ ...base, persona: { directives: ['Be concise.', 'Never fabricate.'] } });
    expect(out.systemPrompt).toContain('Personality (execute under these traits):\n- Be concise.\n- Never fabricate.');
  });

  it('passes through persona exec params and model ref', () => {
    const out = lowerAgentSpec({
      ...base,
      model: { ref: 'builderforce/workforce-abc' },
      persona: { execParams: { thinkLevel: 'high', temperature: 0.4 } },
    });
    expect(out.execParams).toEqual({ thinkLevel: 'high', temperature: 0.4 });
    expect(out.model).toBe('builderforce/workforce-abc');
  });

  it('renders recalled memory context when present', () => {
    const out = lowerAgentSpec({ ...base, memory: { recalledContext: 'Refund window is 30 days.' } });
    expect(out.systemPrompt).toContain("Relevant knowledge (recalled from this agent's memory):\nRefund window is 30 days.");
  });

  it('renders a persistent-state signal line', () => {
    const out = lowerAgentSpec({ ...base, memory: { stateSignal: { step: 7, signal: '0.100,0.200' } } });
    expect(out.systemPrompt).toContain('[Memory: step=7 signal=0.100,0.200 context="persistent agent state"]');
  });

  it('orders sections: identity → persona → recalled → state', () => {
    const out = lowerAgentSpec({
      ...base,
      persona: { directives: ['D'] },
      memory: { recalledContext: 'R', stateSignal: { step: 1, signal: 's' } },
    });
    const idx = (s: string) => out.systemPrompt.indexOf(s);
    expect(idx('You are Ada')).toBeLessThan(idx('Personality'));
    expect(idx('Personality')).toBeLessThan(idx('Relevant knowledge'));
    expect(idx('Relevant knowledge')).toBeLessThan(idx('[Memory:'));
  });
});

describe('agentMemorySignal', () => {
  it('summarises the first four data values to 3dp', () => {
    expect(agentMemorySignal({ step: 3, data: [0.1, 0.2, 0.3, 0.4, 0.5] })).toEqual({ step: 3, signal: '0.100,0.200,0.300,0.400' });
  });
  it('defaults step to 0 and signal to empty when only step/data partially present', () => {
    expect(agentMemorySignal({ data: [] })).toEqual({ step: 0, signal: '' });
  });
  it('returns undefined for a stateless snapshot', () => {
    expect(agentMemorySignal(null)).toBeUndefined();
    expect(agentMemorySignal({})).toBeUndefined();
    expect(agentMemorySignal('nope')).toBeUndefined();
  });
});

describe('buildAgentSystemPrompt / buildAgentInference (api adoption)', () => {
  const d: AgentDescriptor = {
    name: 'Ada',
    title: 'Support Agent',
    bio: 'Answers billing questions.',
    skills: ['billing'],
    mamba_state: { step: 2, data: [0.123456, 0.2] },
  };

  it('builds the persona + memory prompt via the shared lowering', () => {
    const sys = buildAgentSystemPrompt(d);
    expect(sys).toContain('You are Ada, Support Agent. Answers billing questions.');
    expect(sys).toContain('Skills: billing');
    expect(sys).toContain('[Memory: step=2 signal=0.123,0.200 context="persistent agent state"]');
  });

  it('threads compiled persona directives + exec params end to end', () => {
    const out = buildAgentInference({ ...d, personaDirectives: ['Be direct.'], execParams: { temperature: 0.3, thinkLevel: 'medium' } });
    expect(out.systemPrompt).toContain('Personality (execute under these traits):\n- Be direct.');
    expect(out.execParams).toEqual({ temperature: 0.3, thinkLevel: 'medium' });
  });

  it('prepends recalled context when supplied by the caller', () => {
    const sys = buildAgentSystemPrompt({ ...d, recalledContext: 'Refunds: 30 day window.' });
    expect(sys).toContain("Relevant knowledge (recalled from this agent's memory):\nRefunds: 30 day window.");
  });
});
