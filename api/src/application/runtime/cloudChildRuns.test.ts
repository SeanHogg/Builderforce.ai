import { describe, expect, it } from 'vitest';
import { childBrief, childHandle, childIdOf, childPayload, isSubagentRun, parseCloudChild, type CloudChildSpec } from './cloudChildRuns';
import { delegationCaps, meterExecutionIdOf } from './cloudLiveOrchestration';
import { CLOUD_SURFACE_CAPS } from './cloudAgentTools';

/** A cloud sub-agent is its own durable run with an owner pointer — the payload carries who it is. */

const spec: CloudChildSpec = {
  parentExecutionId: 41,
  handle: 'a42',
  label: 'port auth',
  task: 'Move the auth middleware to src/auth.',
  readOnly: false,
  scope: ['src/auth'],
  owner: 'Ada',
};

describe('child payload', () => {
  it('inherits only the routing of its owner and carries its own spec', () => {
    const parent = JSON.stringify({ chatId: 7, cloudAgentRef: 'ag_1', model: 'm', followUp: { directive: 'x' }, reviewRole: 'qa' });
    const out = JSON.parse(childPayload(parent, spec)) as Record<string, unknown>;
    expect(out).toMatchObject({ chatId: 7, cloudAgentRef: 'ag_1', model: 'm', executor: 'durable', lifecycleNeutral: true });
    expect(out.followUp).toBeUndefined();
    expect(out.reviewRole).toBeUndefined();
    expect(parseCloudChild(JSON.stringify(out))).toEqual(spec);
  });

  it('tells a sub-agent run apart from every other run', () => {
    expect(isSubagentRun(childPayload(undefined, spec))).toBe(true);
    expect(isSubagentRun(JSON.stringify({ chatId: 7 }))).toBe(false);
    expect(isSubagentRun('not json')).toBe(false);
    expect(isSubagentRun(null)).toBe(false);
  });
});

describe('child handle', () => {
  it('round-trips through the execution id', () => {
    expect(childHandle(42)).toBe('a42');
    expect(childIdOf('a42')).toBe(42);
    expect(childIdOf('b42')).toBeNull();
  });
});

describe('child brief', () => {
  it('puts the live sub-agent rules in front of the owner prompt and the task as the first turn', () => {
    const { systemPrompt, userContent } = childBrief(spec, 'BASE PROMPT');
    expect(systemPrompt).toContain('spawned by Ada');
    expect(systemPrompt.endsWith('BASE PROMPT')).toBe(true);
    expect(userContent).toContain('Move the auth middleware');
    expect(userContent).toContain('You may write ONLY inside: src/auth');
  });
});

describe('delegation', () => {
  it('lets an owner run live children and narrows a scoped child', () => {
    expect(delegationCaps(CLOUD_SURFACE_CAPS, { kind: 'owner', parent: {} as never, runtime: {} as never }).has('orchestrate.live')).toBe(true);
    const child = delegationCaps(CLOUD_SURFACE_CAPS, { kind: 'child', spec });
    expect(child.has('orchestrate')).toBe(false);
    expect(child.has('orchestrate.live')).toBe(false);
    expect(child.has('human')).toBe(false);
    expect(child.has('repo.write')).toBe(true);
    expect(delegationCaps(CLOUD_SURFACE_CAPS, undefined)).toBe(CLOUD_SURFACE_CAPS);
  });

  it("bills a child's tokens to its parent", () => {
    expect(meterExecutionIdOf(42, { kind: 'child', spec })).toBe(41);
    expect(meterExecutionIdOf(42, undefined)).toBe(42);
  });
});
