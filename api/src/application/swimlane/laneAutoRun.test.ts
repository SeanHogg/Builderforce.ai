import { describe, it, expect } from 'vitest';
import { decideLaneAutoRun, missingCapabilities, type LaneAgentLike } from './laneAutoRun';

const agent = (over: Partial<LaneAgentLike> = {}): LaneAgentLike => ({
  agentRef: 'agent_kevin',
  model: null,
  ...over,
});

describe('decideLaneAutoRun', () => {
  it('runs AS the lane agent when the gate is auto', () => {
    const d = decideLaneAutoRun([agent({ model: 'claude-opus-4-8' })], 'auto');
    expect(d).toEqual({ autoRun: true, agentRef: 'agent_kevin', model: 'claude-opus-4-8' });
  });

  it('does NOT auto-run when the lane gate is human', () => {
    expect(decideLaneAutoRun([agent()], 'human')).toEqual({ autoRun: false });
  });

  it('omits the model when the lane agent did not pin one', () => {
    const d = decideLaneAutoRun([agent({ model: null })], 'auto');
    expect(d.autoRun).toBe(true);
    expect(d.model).toBeUndefined();
  });

  it('uses the first agent that has a ref', () => {
    const agents: LaneAgentLike[] = [
      { agentRef: null, model: null },
      { agentRef: 'agent_b', model: 'm' },
    ];
    expect(decideLaneAutoRun(agents, 'auto')).toEqual({ autoRun: true, agentRef: 'agent_b', model: 'm' });
  });

  it('does NOT auto-run a lane with no configured agent (no "legacy" status auto-run)', () => {
    expect(decideLaneAutoRun([], 'auto')).toEqual({ autoRun: false });
    expect(decideLaneAutoRun(undefined, 'auto')).toEqual({ autoRun: false });
    expect(decideLaneAutoRun([{ agentRef: null, model: null }], 'auto')).toEqual({ autoRun: false });
  });

  describe('capability guardrail', () => {
    it('runs an agent that has every required capability', () => {
      const d = decideLaneAutoRun(
        [agent({ requiredCapabilities: ['coding-agent'], capabilities: ['coding-agent', 'code-creator'] })],
        'auto',
      );
      expect(d).toEqual({ autoRun: true, agentRef: 'agent_kevin', model: undefined });
    });

    it('does NOT auto-run a lane whose only agent lacks a required capability', () => {
      // A docs/BA agent (no coding capability) on a lane that requires coding.
      const d = decideLaneAutoRun(
        [agent({ requiredCapabilities: ['coding-agent'], capabilities: ['documentation-agent'] })],
        'auto',
      );
      expect(d.autoRun).toBe(false);
      expect(d.capabilityMismatches).toEqual([{ agentRef: 'agent_kevin', missing: ['coding-agent'] }]);
    });

    it('skips a mismatched agent and runs the next one that qualifies', () => {
      const d = decideLaneAutoRun(
        [
          { agentRef: 'agent_docs', model: null, requiredCapabilities: ['coding-agent'], capabilities: ['documentation-agent'] },
          { agentRef: 'agent_dev', model: 'm', requiredCapabilities: ['coding-agent'], capabilities: ['coding-agent'] },
        ],
        'auto',
      );
      expect(d.autoRun).toBe(true);
      expect(d.agentRef).toBe('agent_dev');
      expect(d.capabilityMismatches).toEqual([{ agentRef: 'agent_docs', missing: ['coding-agent'] }]);
    });

    it('treats an empty / absent requirement as no requirement', () => {
      expect(decideLaneAutoRun([agent({ requiredCapabilities: [] })], 'auto').autoRun).toBe(true);
      expect(decideLaneAutoRun([agent({ requiredCapabilities: undefined })], 'auto').autoRun).toBe(true);
    });
  });
});

describe('missingCapabilities', () => {
  it('returns [] when nothing is required', () => {
    expect(missingCapabilities([], ['x'])).toEqual([]);
    expect(missingCapabilities(undefined, ['x'])).toEqual([]);
  });

  it('lists the required slugs the agent does not have (case-insensitive)', () => {
    expect(missingCapabilities(['Coding-Agent', 'github'], ['coding-agent'])).toEqual(['github']);
  });

  it('returns [] when every requirement is satisfied', () => {
    expect(missingCapabilities(['coding-agent'], ['coding-agent', 'code-creator'])).toEqual([]);
  });
});
