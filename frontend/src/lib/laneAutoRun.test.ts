import { describe, expect, it } from 'vitest';
import { decideLaneAutoRun, type LaneAgentLike } from './laneAutoRun';

const cloudAgent = (agentRef: string | null, model: string | null = null): LaneAgentLike => ({
  runtime: 'cloud', agentRef, model,
});

describe('decideLaneAutoRun', () => {
  it('runs AS the lane cloud agent when the lane gate is auto (the reported bug)', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder', 'anthropic/claude-sonnet-4.6')], 'todo', 'auto');
    expect(d).toEqual({ autoRun: true, cloudAgentRef: 'agent-v2-coder', model: 'anthropic/claude-sonnet-4.6' });
  });

  it('passes the agent ref even without a pinned model', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder')], 'todo', 'auto');
    expect(d).toEqual({ autoRun: true, cloudAgentRef: 'agent-v2-coder', model: undefined });
  });

  it('treats an undefined gate as auto (lanes with agents default to autonomous)', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder')], 'todo', undefined);
    expect(d).toEqual({ autoRun: true, cloudAgentRef: 'agent-v2-coder', model: undefined });
  });

  it('does NOT auto-run a configured lane behind a human gate (waits for approval)', () => {
    const d = decideLaneAutoRun([cloudAgent('agent-v2-coder')], 'todo', 'human');
    expect(d).toEqual({ autoRun: false });
  });

  it('falls back to legacy status auto-run when the lane has no cloud agent', () => {
    expect(decideLaneAutoRun([], 'todo', 'human')).toEqual({ autoRun: true });
    expect(decideLaneAutoRun([], 'in_progress', undefined)).toEqual({ autoRun: true });
    expect(decideLaneAutoRun(undefined, 'todo', 'auto')).toEqual({ autoRun: true });
  });

  it('does not auto-run non-active statuses with no configured agent', () => {
    expect(decideLaneAutoRun([], 'backlog', 'auto')).toEqual({ autoRun: false });
    expect(decideLaneAutoRun([], 'done', 'auto')).toEqual({ autoRun: false });
  });

  it('ignores non-cloud lane agents (host/local handled by the coordinator path)', () => {
    const remote: LaneAgentLike = { runtime: 'remote', agentRef: 'host-agent', model: null };
    // No cloud agent present → legacy decision, no cloudAgentRef leaked.
    expect(decideLaneAutoRun([remote], 'todo', 'auto')).toEqual({ autoRun: true });
    expect(decideLaneAutoRun([remote], 'backlog', 'auto')).toEqual({ autoRun: false });
  });
});
