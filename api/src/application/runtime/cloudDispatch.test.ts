import { describe, it, expect } from 'vitest';
import {
  resolveCloudSurface, chooseCloudExecutor, probeContainerHealth, isTerminalExecutionStatus,
  parseFollowUp, buildFollowUpPayload,
} from './cloudDispatch';

describe('chooseCloudExecutor', () => {
  it('uses the container ONLY when wanted, bound, AND proven healthy', () => {
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: true, containerHealthy: true, hasCloudRunner: true })).toBe('container');
  });
  it('REGRESSION: a bound-but-unhealthy container falls back to durable, not container', () => {
    // The exact bug the user hit: the container DO acked /run 202 while the image
    // was dead, and the run was orphan-reaped instead of running on durable.
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: true, containerHealthy: false, hasCloudRunner: true })).toBe('durable');
  });
  it('falls back to durable when the container is wanted but not bound', () => {
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: false, containerHealthy: false, hasCloudRunner: true })).toBe('durable');
  });
  it('uses durable for non-container runs (V1 / V2 durable)', () => {
    expect(chooseCloudExecutor({ wantsContainer: false, hasContainerBinding: false, containerHealthy: false, hasCloudRunner: true })).toBe('durable');
  });
  it('falls to the in-request worker only when no durable runner is bound', () => {
    expect(chooseCloudExecutor({ wantsContainer: false, hasContainerBinding: false, containerHealthy: false, hasCloudRunner: false })).toBe('worker');
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: true, containerHealthy: false, hasCloudRunner: false })).toBe('worker');
  });
});

describe('probeContainerHealth', () => {
  it('returns true when /health responds ok', async () => {
    const stub = { fetch: async () => new Response('{"ok":true}', { status: 200 }) };
    expect(await probeContainerHealth(stub)).toBe(true);
  });
  it('returns false on a non-200 (container up but unhealthy)', async () => {
    const stub = { fetch: async () => new Response('nope', { status: 503 }) };
    expect(await probeContainerHealth(stub)).toBe(false);
  });
  it('returns false when the probe throws/times out (container not live)', async () => {
    const stub = { fetch: async () => { throw new Error('container failed to start'); } };
    expect(await probeContainerHealth(stub)).toBe(false);
  });
});

describe('isTerminalExecutionStatus', () => {
  it('treats completed/failed/cancelled as terminal', () => {
    expect(isTerminalExecutionStatus('completed')).toBe(true);
    expect(isTerminalExecutionStatus('failed')).toBe(true);
    expect(isTerminalExecutionStatus('cancelled')).toBe(true);
  });
  it('treats live/queued states as non-terminal (steerable)', () => {
    expect(isTerminalExecutionStatus('pending')).toBe(false);
    expect(isTerminalExecutionStatus('submitted')).toBe(false);
    expect(isTerminalExecutionStatus('running')).toBe(false);
    expect(isTerminalExecutionStatus(null)).toBe(false);
    expect(isTerminalExecutionStatus(undefined)).toBe(false);
  });
});

describe('parseFollowUp', () => {
  it('extracts a trimmed directive and prior execution id', () => {
    const r = parseFollowUp(JSON.stringify({ followUp: { directive: '  add retries  ', priorExecutionId: 55 } }));
    expect(r).toEqual({ directive: 'add retries', priorExecutionId: 55 });
  });
  it('returns null when there is no follow-up block', () => {
    expect(parseFollowUp(JSON.stringify({ model: 'x' }))).toBeNull();
    expect(parseFollowUp(undefined)).toBeNull();
    expect(parseFollowUp('not json')).toBeNull();
  });
  it('returns null for an empty/whitespace directive', () => {
    expect(parseFollowUp(JSON.stringify({ followUp: { directive: '   ' } }))).toBeNull();
    expect(parseFollowUp(JSON.stringify({ followUp: {} }))).toBeNull();
  });
  it('defaults priorExecutionId to null when missing or non-finite', () => {
    expect(parseFollowUp(JSON.stringify({ followUp: { directive: 'go' } }))?.priorExecutionId).toBeNull();
    expect(parseFollowUp(JSON.stringify({ followUp: { directive: 'go', priorExecutionId: Number.NaN } }))?.priorExecutionId).toBeNull();
  });
});

describe('buildFollowUpPayload', () => {
  it('preserves the prior run agent/model pin and attaches the directive', () => {
    const prior = JSON.stringify({ cloudAgentRef: 'agent-7', model: 'claude-opus-4-8', repoId: 'r1' });
    const out = JSON.parse(buildFollowUpPayload(prior, { directive: 'use Go', priorExecutionId: 42 }));
    expect(out.cloudAgentRef).toBe('agent-7');
    expect(out.model).toBe('claude-opus-4-8');
    expect(out.repoId).toBe('r1');
    expect(out.followUp).toEqual({ directive: 'use Go', priorExecutionId: 42 });
  });
  it('drops a stale remediation block from the prior payload', () => {
    const prior = JSON.stringify({ remediation: { kind: 'build_failure', buildError: 'boom' }, model: 'm' });
    const out = JSON.parse(buildFollowUpPayload(prior, { directive: 'next', priorExecutionId: 1 }));
    expect(out.remediation).toBeUndefined();
    expect(out.model).toBe('m');
    expect(out.followUp.directive).toBe('next');
  });
  it('tolerates a missing/invalid prior payload', () => {
    const out = JSON.parse(buildFollowUpPayload(undefined, { directive: 'd', priorExecutionId: 9 }));
    expect(out.followUp).toEqual({ directive: 'd', priorExecutionId: 9 });
    const out2 = JSON.parse(buildFollowUpPayload('not json', { directive: 'd', priorExecutionId: 9 }));
    expect(out2.followUp.priorExecutionId).toBe(9);
  });
});

describe('resolveCloudSurface', () => {
  it('an explicitly-pinned host is a long-lived (container/relay) runtime', () => {
    expect(resolveCloudSurface('durable', true)).toBe('container');
    expect(resolveCloudSurface(undefined, true)).toBe('container');
  });

  it('honors the agent\'s chosen surface when no host is pinned', () => {
    expect(resolveCloudSurface('container', false)).toBe('container');
    expect(resolveCloudSurface('durable', false)).toBe('durable');
  });

  it('defaults to durable for an unset/unknown surface (on-demand, no always-on infra)', () => {
    expect(resolveCloudSurface(undefined, false)).toBe('durable');
    expect(resolveCloudSurface(null, false)).toBe('durable');
    expect(resolveCloudSurface('something-else', false)).toBe('durable');
  });
});
