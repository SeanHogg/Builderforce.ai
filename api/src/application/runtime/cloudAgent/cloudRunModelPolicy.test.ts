import { describe, expect, it } from 'vitest';
import { cloudRunRole } from './cloudRunModelPolicy';

// The rest of this file's cases moved with the behaviour to `packages/agent-run/test/model/model.test.ts`
// (completeUnderRunPolicy → "requestForTurn / routeAroundFailure / recordSuccess", resumeCloudRunModelState →
// "resumeModelRunState", cloudStallStep → "stallStep") and to `cloudAdapterPorts.test.ts` (recordModelCascade).

describe('the phase rule', () => {
  it('a ticket run codes; a plan or verify child starts in that phase; a non-phase child keeps its role', () => {
    expect(cloudRunRole(undefined)).toBe('code');
    expect(cloudRunRole('plan')).toBe('plan');
    expect(cloudRunRole('verify')).toBe('verify');
    expect(cloudRunRole('explore')).toBe('explore');
    // A board delivery role is not a model role: the run still codes.
    expect(cloudRunRole('reviewer')).toBe('code');
  });
});
