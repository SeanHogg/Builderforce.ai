import { describe, expect, it } from 'vitest';
import type { PolicyContext } from '@builderforce/agent-run';
import { brainFinishHook } from './brainFinish';

/** The slice of a policy context the live-children hold reads: a top-level owner (no parent run). */
const owner = { task: { dispatch: {} } } as unknown as PolicyContext;

describe('the Brain finish module', () => {
  it('holds an OWNER run while the host says its sub-agents are still working (no wake run with an empty ask)', async () => {
    const hook = brainFinishHook({ liveChildren: async () => 'Sub-agents still working: a1.' });
    expect(await hook.liveChildren?.(owner)).toBe('Sub-agents still working: a1.');
  });

  it('lets it end once none is live', async () => {
    const hook = brainFinishHook({ liveChildren: async () => null });
    expect(await hook.liveChildren?.(owner)).toBeNull();
  });

  it('is the port-less default on a surface with no delegation', async () => {
    expect(await brainFinishHook({}).liveChildren?.(owner)).toBeNull();
  });
});
