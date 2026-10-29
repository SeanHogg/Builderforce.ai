import { describe, expect, it } from 'vitest';
import { policyRole } from '@builderforce/agent-run';
import { cloudRunRole } from './cloudRunModelPolicy';

// The rest of this file's cases moved with the behaviour to the agent: the hand-off (seed and lock, 429 / Evermind route-around, forced tool choice, stall re-prompt then failover)
// to `packages/agent-run/test/cloud/modelHandoff.test.ts`, the resume path and the stall budget to `packages/agent-run/test/model/model.test.ts`, and
// the timeline row of a cascade to `../cloudAdapterPorts.test.ts`.

describe('the phase rule', () => {
  it('a ticket run codes; a plan or verify child starts in that phase; a non-phase child keeps its role', () => {
    expect(cloudRunRole(undefined)).toBe('code');
    expect(cloudRunRole('plan')).toBe('plan');
    expect(cloudRunRole('verify')).toBe('verify');
    expect(cloudRunRole('explore')).toBe('explore');
    // The phase rule itself is the agent's (`cloudRunPolicyRole` was its api alias): same input, same expected value.
    expect(policyRole('explore')).toEqual({ startPhase: 'code', fixedRole: 'explore' });
    // A board delivery role is not a model role: the run still codes.
    expect(cloudRunRole('reviewer')).toBe('code');
  });
});
