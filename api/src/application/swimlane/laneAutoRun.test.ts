import { describe, it, expect } from 'vitest';
import { decideLaneAutoRun, type LaneAgentLike } from './laneAutoRun';

const cloudAgent = (over: Partial<LaneAgentLike> = {}): LaneAgentLike => ({
  runtime: 'cloud',
  agentRef: 'agent_kevin',
  model: null,
  ...over,
});

describe('decideLaneAutoRun', () => {
  it('runs AS the lane cloud agent when the lane gate is auto', () => {
    const d = decideLaneAutoRun([cloudAgent({ model: 'claude-opus-4-8' })], 'todo', 'auto');
    expect(d).toEqual({ autoRun: true, cloudAgentRef: 'agent_kevin', model: 'claude-opus-4-8' });
  });

  it('does NOT auto-run a lane with a cloud agent when the gate is human', () => {
    const d = decideLaneAutoRun([cloudAgent()], 'todo', 'human');
    expect(d).toEqual({ autoRun: false });
  });

  it('fires for an agent lane even on a status outside the legacy set', () => {
    // The reported bug: a configured agent must run regardless of which lane key
    // it sits in — not only on the legacy todo/in_progress columns.
    const d = decideLaneAutoRun([cloudAgent()], 'ready', 'auto');
    expect(d.autoRun).toBe(true);
    expect(d.cloudAgentRef).toBe('agent_kevin');
  });

  it('omits the model when the lane agent did not pin one', () => {
    const d = decideLaneAutoRun([cloudAgent({ model: null })], 'todo', 'auto');
    expect(d.autoRun).toBe(true);
    expect(d.model).toBeUndefined();
  });

  it('ignores non-cloud and ref-less agents, falling back to legacy behaviour', () => {
    const agents: LaneAgentLike[] = [
      { runtime: 'local', agentRef: 'x', model: null },
      { runtime: 'cloud', agentRef: null, model: null },
    ];
    expect(decideLaneAutoRun(agents, 'todo', 'auto').autoRun).toBe(true); // legacy: todo
    expect(decideLaneAutoRun(agents, 'todo', 'auto').cloudAgentRef).toBeUndefined();
    expect(decideLaneAutoRun(agents, 'backlog', 'auto').autoRun).toBe(false);
  });

  it('legacy default-column behaviour: no agents → auto-run only on todo/in_progress', () => {
    expect(decideLaneAutoRun(undefined, 'todo', undefined).autoRun).toBe(true);
    expect(decideLaneAutoRun(undefined, 'in_progress', undefined).autoRun).toBe(true);
    expect(decideLaneAutoRun([], 'backlog', undefined).autoRun).toBe(false);
    expect(decideLaneAutoRun([], 'in_review', undefined).autoRun).toBe(false);
    expect(decideLaneAutoRun([], 'done', undefined).autoRun).toBe(false);
  });
});
