import { describe, expect, it } from 'vitest';
import { createFinishHook, type PolicyContext } from '@builderforce/agent-run';
import { brainFinishPorts } from './brainFinish';

/** The finish module `openRun` builds from the Brain's ports (`surface.finish`). */
const brainFinishHook = (...args: Parameters<typeof brainFinishPorts>) => createFinishHook(brainFinishPorts(...args));

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

  it('binds the open-work port', async () => {
    const hook = brainFinishHook({}, async () => 'Epic #6902 is still open.');
    expect(await hook.openWork?.(owner)).toBe('Epic #6902 is still open.');
    expect(await brainFinishHook({}).openWork?.(owner)).toBeNull();
  });

  it('runs an open-work gate sequence in order: the first gate that holds wins, a later one is not consulted', async () => {
    const asked: string[] = [];
    const gate = (name: string, block: string | null) => async () => { asked.push(name); return block; };
    expect(await brainFinishHook({}, [gate('open', null), gate('spec', 'P25-09 has no ticket.')]).openWork?.(owner)).toBe('P25-09 has no ticket.');
    expect(asked).toEqual(['open', 'spec']);
    asked.length = 0;
    expect(await brainFinishHook({}, [gate('open', 'Epic #1 is open.'), gate('spec', 'x')]).openWork?.(owner)).toBe('Epic #1 is open.');
    expect(asked).toEqual(['open']);
    expect(await brainFinishHook({}, [gate('open', null), gate('spec', null)]).openWork?.(owner)).toBeNull();
  });

  it('is the port-less default on a surface with no delegation', async () => {
    expect(await brainFinishHook({}).liveChildren?.(owner)).toBeNull();
  });
});
