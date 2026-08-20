import { describe, it, expect } from 'vitest';
import { decideLaneAutoRun, missingCapabilities, scoreLaneAgent, withOwnerAgentFallback, type LaneAgentLike } from './laneAutoRun';

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

describe('decideLaneAutoRun — the staffed BACKPLANE of a lane', () => {
  it('carries runtime + target off the chosen lane agent', () => {
    const lane: LaneAgentLike[] = [{ agentRef: 'agent_ada', model: null, runtime: 'remote', target: '42' }];
    expect(decideLaneAutoRun(lane, 'auto')).toEqual({
      autoRun: true, agentRef: 'agent_ada', model: undefined, runtime: 'remote', target: '42',
    });
  });

  it('omits both when the assignment names neither (a cloud lane, unchanged)', () => {
    const lane: LaneAgentLike[] = [{ agentRef: 'agent_ada', model: null }];
    expect(decideLaneAutoRun(lane, 'auto')).toEqual({ autoRun: true, agentRef: 'agent_ada', model: undefined });
  });

  it('reads the backplane of the agent that actually QUALIFIED, not the first staffed one', () => {
    const lane: LaneAgentLike[] = [
      { agentRef: 'agent_docs', model: null, runtime: 'cloud', requiredCapabilities: ['coding'], capabilities: ['writing'] },
      { agentRef: 'agent_dev', model: null, runtime: 'local', requiredCapabilities: ['coding'], capabilities: ['coding'] },
    ];
    const d = decideLaneAutoRun(lane, 'auto');
    expect(d.agentRef).toBe('agent_dev');
    expect(d.runtime).toBe('local');
  });
});

describe('capability-aware routing — which qualified agent the lane actually gets', () => {
  it('prefers the agent whose skills match what the lane is FOR, not the first row', () => {
    const lane: LaneAgentLike[] = [
      { agentRef: 'agent_reviewer', model: null, capabilities: ['code-review', 'qa'] },
      { agentRef: 'agent_coder', model: null, capabilities: ['coding'] },
    ];
    // Un-configured lane: no required_capabilities anywhere, so the LANE KEY supplies
    // the expectation. Before the router this returned agent_reviewer every time.
    expect(decideLaneAutoRun(lane, 'auto', 'in_progress').agentRef).toBe('agent_coder');
    expect(decideLaneAutoRun(lane, 'auto', 'in_review').agentRef).toBe('agent_reviewer');
  });

  it('keeps assignment order when nothing distinguishes the candidates', () => {
    const lane: LaneAgentLike[] = [
      { agentRef: 'agent_a', model: null, capabilities: ['coding'] },
      { agentRef: 'agent_b', model: null, capabilities: ['coding'] },
    ];
    expect(decideLaneAutoRun(lane, 'auto', 'in_progress').agentRef).toBe('agent_a');
  });

  it('is inert on a lane key it has no expectation for', () => {
    const lane: LaneAgentLike[] = [
      { agentRef: 'agent_reviewer', model: null, capabilities: ['code-review'] },
      { agentRef: 'agent_coder', model: null, capabilities: ['coding'] },
    ];
    expect(decideLaneAutoRun(lane, 'auto', 'some_custom_lane').agentRef).toBe('agent_reviewer');
    expect(decideLaneAutoRun(lane, 'auto').agentRef).toBe('agent_reviewer');
  });

  it('never promotes the owner fallback ahead of explicit staffing', () => {
    const staffed: LaneAgentLike[] = [{ agentRef: 'agent_staffed', model: null, capabilities: [] }];
    const withOwner = withOwnerAgentFallback(staffed, { agentRef: 'agent_owner' });
    // The owner has no resolved capabilities either, but it must stay last on merit or not.
    expect(decideLaneAutoRun(withOwner, 'auto', 'in_progress').agentRef).toBe('agent_staffed');
  });

  it('still REFUSES an agent that fails an explicit requirement, however well it scores', () => {
    const lane: LaneAgentLike[] = [
      { agentRef: 'agent_coder', model: null, requiredCapabilities: ['security-clearance'], capabilities: ['coding'] },
    ];
    expect(decideLaneAutoRun(lane, 'auto', 'in_progress')).toMatchObject({ autoRun: false });
  });

  it('scoreLaneAgent matches a slug that CONTAINS the expected term', () => {
    expect(scoreLaneAgent({ capabilities: ['senior-coding-agent'] }, ['coding'])).toBe(1);
    expect(scoreLaneAgent({ capabilities: ['writing'] }, ['coding'])).toBe(0);
    expect(scoreLaneAgent({ capabilities: null }, ['coding'])).toBe(0);
    expect(scoreLaneAgent({ capabilities: ['coding'] }, [])).toBe(0);
  });
});

describe('withOwnerAgentFallback', () => {
  it('appends the owner agent as a fallback when the lane has no staffing', () => {
    const list = withOwnerAgentFallback([], { agentRef: 'agent_ada' });
    // `runtime`/`target` are explicitly null: the owner fallback names WHO works the
    // ticket, not WHERE, so the dispatcher keeps its ordinary host-pin/cloud resolution.
    expect(list).toEqual([{ agentRef: 'agent_ada', model: null, requiredCapabilities: null, capabilities: null, runtime: null, target: null, isOwnerFallback: true }]);
    // …and the decision then auto-runs AS the owner (the bug fix: an agent-owned
    // ticket in an auto lane with no lane staffing now runs).
    expect(decideLaneAutoRun(list, 'auto')).toEqual({ autoRun: true, agentRef: 'agent_ada', model: undefined });
  });

  it('also covers an undefined lane-agent list', () => {
    expect(withOwnerAgentFallback(undefined, { agentRef: 'agent_ada' })).toEqual([
      { agentRef: 'agent_ada', model: null, requiredCapabilities: null, capabilities: null, runtime: null, target: null, isOwnerFallback: true },
    ]);
  });

  it('keeps explicit lane staffing ahead of the owner (staffing wins)', () => {
    const lane: LaneAgentLike[] = [{ agentRef: 'agent_lane', model: 'm' }];
    const list = withOwnerAgentFallback(lane, { agentRef: 'agent_ada' });
    expect(list.map((a) => a.agentRef)).toEqual(['agent_lane', 'agent_ada']);
    expect(decideLaneAutoRun(list, 'auto').agentRef).toBe('agent_lane');
  });

  it('does NOT duplicate the owner when it is already a lane agent', () => {
    const lane: LaneAgentLike[] = [{ agentRef: 'agent_ada', model: 'm' }];
    expect(withOwnerAgentFallback(lane, { agentRef: 'agent_ada' })).toEqual(lane);
  });

  it('is a no-op when there is no owner agent (human-owned or unassigned ticket)', () => {
    const lane: LaneAgentLike[] = [{ agentRef: 'agent_lane', model: null }];
    expect(withOwnerAgentFallback(lane, { agentRef: null })).toEqual(lane);
    expect(withOwnerAgentFallback(lane, { agentRef: undefined })).toEqual(lane);
    expect(withOwnerAgentFallback(lane, { agentRef: '  ' })).toEqual(lane);
    expect(withOwnerAgentFallback([], undefined)).toEqual([]);
  });

  it('carries the owner pinned model through when provided', () => {
    const list = withOwnerAgentFallback([], { agentRef: 'agent_ada', model: 'claude-opus-4-8' });
    expect(list[0]).toMatchObject({ agentRef: 'agent_ada', model: 'claude-opus-4-8' });
  });

  it('a human-gated lane still does not auto-run an owner-assigned ticket', () => {
    const list = withOwnerAgentFallback([], { agentRef: 'agent_ada' });
    expect(decideLaneAutoRun(list, 'human')).toEqual({ autoRun: false });
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
