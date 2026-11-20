import { describe, expect, it } from 'vitest';
import { DEFAULT_MANAGER_POLICY, resolveTieredManagerPolicy, type EffectiveManagerPolicy, type PrMergePolicy } from './managerPolicy';
import { cloudMergeOf, shipPoliciesOf } from './shipPolicyOf';

const policy = (o: Partial<EffectiveManagerPolicy> = {}): EffectiveManagerPolicy => ({ ...DEFAULT_MANAGER_POLICY, ...o });

describe('shipPoliciesOf — PRD 48 §4.1, the one mapper from project settings to run ship policies', () => {
  const MERGE_POLICIES: PrMergePolicy[] = ['immediate', 'on_green', 'queue'];

  for (const prMergePolicy of MERGE_POLICIES) {
    for (const allowAutoMerge of [true, false]) {
      for (const enabled of [true, false]) {
        for (const managed of [true, false]) {
          for (const canary of [false, true]) {
            const expected = !managed || canary || !enabled || !allowAutoMerge || prMergePolicy === 'queue'
              ? 'never'
              : prMergePolicy === 'on_green' ? 'on_green' : 'immediate';
            it(`cloud merge is ${expected} for prMergePolicy=${prMergePolicy} allowAutoMerge=${allowAutoMerge} enabled=${enabled} managed=${managed} canary=${canary}`, () => {
              const p = policy({ prMergePolicy, allowAutoMerge, enabled, canary });
              const { cloud } = shipPoliciesOf(p, managed);
              expect(cloud.merge).toBe(expected);
              expect(cloudMergeOf(p, managed)).toBe(expected);
              // A cloud run ALWAYS opens a pull request, whatever the merge.
              expect(cloud.mode).toBe('pull_request');
              expect(cloud.source).toBe('project_settings');
            });
          }
        }
      }
    }
  }

  it('an UNMANAGED project never merges, even when its workspace grants auto-merge (the sweep never visits it)', () => {
    const workspaceGrant = resolveTieredManagerPolicy({ tenant: { allowAutoMerge: true, prMergePolicy: 'immediate' } });
    expect(workspaceGrant.allowAutoMerge).toBe(true);
    expect(shipPoliciesOf(workspaceGrant, false).cloud.merge).toBe('never');
    expect(shipPoliciesOf(workspaceGrant, true).cloud.merge).toBe('immediate');
  });

  it('a project in canary never merges (the sweep logs what it would have merged)', () => {
    expect(shipPoliciesOf(policy({ allowAutoMerge: true, canary: true }), true).cloud.merge).toBe('never');
  });

  it('cloud review is required exactly when the project requires sign-off', () => {
    expect(shipPoliciesOf(policy({ requireSignoffToComplete: true }), true).cloud.review).toBe('required');
    expect(shipPoliciesOf(policy({ requireSignoffToComplete: false }), true).cloud.review).toBe('none');
  });

  it('the cloud policy ignores shipMode: a cloud run opens a PR even when local runs leave work uncommitted', () => {
    expect(shipPoliciesOf(policy({ shipMode: 'leave_uncommitted', shipModeSource: 'project' }), true).cloud.mode).toBe('pull_request');
    expect(shipPoliciesOf(policy({ shipMode: 'commit_push', shipModeSource: 'project' }), true).cloud.mode).toBe('pull_request');
  });

  it('the local policy is the project shipMode, sourced from project settings', () => {
    const { local } = shipPoliciesOf(policy({ shipMode: 'commit_push', shipModeSource: 'project' }), true);
    expect(local).toEqual({ mode: 'commit_push', merge: 'never', review: 'none', source: 'project_settings' });
    expect(shipPoliciesOf(policy({ shipMode: 'pull_request', shipModeSource: 'workspace' }), false).local.source).toBe('project_settings');
  });

  it('with no tier set, the local policy is the built-in commit with a `default` source', () => {
    const { local, cloud } = shipPoliciesOf(resolveTieredManagerPolicy({}), false);
    expect(local).toEqual({ mode: 'commit', merge: 'never', review: 'none', source: 'default' });
    // Defaults: merge authority is withheld, so the cloud PR opens and nothing merges.
    expect(cloud).toEqual({ mode: 'pull_request', merge: 'never', review: 'none', source: 'project_settings' });
  });
});
