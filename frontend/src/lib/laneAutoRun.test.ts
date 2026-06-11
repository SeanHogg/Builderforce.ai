import { describe, expect, it } from 'vitest';
import { decideLaneAutoRun, type LaneAgentLike } from './laneAutoRun';

const cloudAgent = (agentRef: string | null, model: string | null = null): LaneAgentLike => ({
  runtime: 'cloud', agentRef, model,
});

describe('decideLaneAutoRun', () => {
  it('runs AS the lane cloud agent when the board is autonomous (the reported bug)', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder', 'anthropic/claude-sonnet-4.6')], 'todo', true);
    expect(d).toEqual({ autoRun: true, cloudAgentRef: 'agent-v2-coder', model: 'anthropic/claude-sonnet-4.6' });
  });

  it('passes the agent ref even without a pinned model', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder')], 'todo', true);
    expect(d).toEqual({ autoRun: true, cloudAgentRef: 'agent-v2-coder', model: undefined });
  });

  it('does not auto-run a configured lane when the board master switch is off', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder')], 'todo', false);
    expect(d).toEqual({ autoRun: false });
  });

  it('falls back to legacy status auto-run when the lane has no cloud agent', () => {
    expect(decideLaneAutoRun([], 'todo', false)).toEqual({ autoRun: true });
    expect(decideLaneAutoRun([], 'in_progress', false)).toEqual({ autoRun: true });
    expect(decideLaneAutoRun(undefined, 'todo', true)).toEqual({ autoRun: true });
  });

  it('does not auto-run non-active statuses with no configured agent', () => {
    expect(decideLaneAutoRun([], 'backlog', true)).toEqual({ autoRun: false });
    expect(decideLaneAutoRun([], 'done', true)).toEqual({ autoRun: false });
  });

  it('ignores non-cloud lane agents (host/local handled by the coordinator path)', () => {
    const remote: LaneAgentLike = { runtime: 'remote', agentRef: 'host-agent', model: null };
    // No cloud agent present → legacy decision, no cloudAgentRef leaked.
    expect(decideLaneAutoRun([remote], 'todo', true)).toEqual({ autoRun: true });
    expect(decideLaneAutoRun([remote], 'backlog', true)).toEqual({ autoRun: false });
  });
});
