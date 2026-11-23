import { describe, expect, it } from 'vitest';
import { delegationCaps, meterExecutionIdOf, type CloudRunDelegation } from './cloudRunDelegation';
import { CLOUD_SURFACE_CAPS } from './cloudAgentTools';
import type { CloudChildSpec } from './cloudChildSpec';

const spec: CloudChildSpec = {
  parentExecutionId: 41,
  rootExecutionId: 40,
  depth: 2,
  handle: 'a42',
  label: 'port auth',
  task: 'Move the auth middleware to src/auth.',
  owner: 'Ada',
};

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
