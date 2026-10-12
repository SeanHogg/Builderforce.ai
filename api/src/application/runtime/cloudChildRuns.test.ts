import { describe, expect, it } from 'vitest';
import { childBrief, childHandle, childIdOf, childPayload, isSubagentRun, parseCloudChild, type CloudChildSpec } from './cloudChildRuns';
import { delegationCaps, meterExecutionIdOf, type CloudRunDelegation } from './cloudRunDelegation';
import { CLOUD_SURFACE_CAPS } from './cloudAgentTools';

/** A cloud sub-agent is its own durable run with an owner pointer — the payload carries who it is. */

const spec: CloudChildSpec = {
  parentExecutionId: 41,
  rootExecutionId: 40,
  depth: 2,
  handle: 'a42',
  label: 'port auth',
  task: 'Move the auth middleware to src/auth.',
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
    expect(userContent).toBe('Move the auth middleware to src/auth.');
    expect(systemPrompt).toContain('every tool your owner holds');
  });
});

describe('delegation', () => {
  const tree = (spec?: CloudChildSpec): CloudRunDelegation => ({ parent: {} as never, runtime: {} as never, ...(spec ? { spec } : {}) });

  it('lets every durable run spawn, and a dry run none', () => {
    expect(delegationCaps(CLOUD_SURFACE_CAPS, tree()).has('orchestrate.live')).toBe(true);
    const dry = delegationCaps(CLOUD_SURFACE_CAPS, undefined);
    expect(dry.has('orchestrate')).toBe(false);
    expect(dry.has('orchestrate.live')).toBe(false);
  });

  it('hands a child its owner\'s capabilities, and lets it spawn only above the depth cap', () => {
    const child = delegationCaps(CLOUD_SURFACE_CAPS, tree(spec));
    expect(child.has('human')).toBe(false);
    for (const c of ['repo.write', 'shell', 'git.write'] as const) expect(child.has(c)).toBe(CLOUD_SURFACE_CAPS.has(c));
    expect(child.has('orchestrate.live')).toBe(true);
    expect(delegationCaps(CLOUD_SURFACE_CAPS, tree({ ...spec, depth: 3 })).has('orchestrate')).toBe(false);
  });

  it("bills a tree's tokens to its root run", () => {
    expect(meterExecutionIdOf(42, tree(spec))).toBe(40);
    expect(meterExecutionIdOf(42, tree())).toBe(42);
  });
});
