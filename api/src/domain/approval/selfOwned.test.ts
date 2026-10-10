import { describe, expect, it } from 'vitest';
import { isApprovalVisibleTo, isSelfOwnedApproval } from './selfOwned';

describe('self-owned approvals', () => {
  it('recognises the Synapse step approval and nothing else', () => {
    expect(isSelfOwnedApproval('synapse.step')).toBe(true);
    expect(isSelfOwnedApproval('workflow.run')).toBe(false);
    expect(isSelfOwnedApproval(null)).toBe(false);
  });

  it('shows a self-owned approval only to the user who raised it', () => {
    const own = { actionType: 'synapse.step', requestedBy: 'u1' };
    expect(isApprovalVisibleTo(own, 'u1')).toBe(true);
    expect(isApprovalVisibleTo(own, 'u2')).toBe(false);
    expect(isApprovalVisibleTo(own, undefined)).toBe(false);
  });

  it('leaves team approvals visible to the tenant', () => {
    expect(isApprovalVisibleTo({ actionType: 'workflow.run', requestedBy: 'host-7' }, 'u2')).toBe(true);
  });
});
