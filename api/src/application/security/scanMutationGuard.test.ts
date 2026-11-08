import { describe, expect, it } from 'vitest';
import { guardScanMutation } from './scanMutationGuard';

describe('guardScanMutation', () => {
  const agentScan = { id: 's', pullRequestId: 'pr', headSha: 'abc', triggeredBy: 'agent:coder' };

  it('refuses to delete a platform-recorded scan', () => {
    expect(guardScanMutation('delete', agentScan, null)).toMatch(/cannot be deleted/);
  });

  it('refuses to change the status of a platform-recorded scan, but allows other fields', () => {
    expect(guardScanMutation('update', agentScan, { status: 'completed' })).toMatch(/status/);
    expect(guardScanMutation('update', agentScan, { notes: 'looked at it' })).toBeNull();
  });

  it('treats a Run-scan or system scan as platform-recorded even with no PR', () => {
    expect(guardScanMutation('delete', { triggeredBy: 'user:42' }, null)).not.toBeNull();
    expect(guardScanMutation('delete', { triggeredBy: 'system' }, null)).not.toBeNull();
  });

  it('leaves a hand-entered scan fully editable', () => {
    const manual = { id: 'm', pullRequestId: null, headSha: null, triggeredBy: 'Jane (pen test)' };
    expect(guardScanMutation('delete', manual, null)).toBeNull();
    expect(guardScanMutation('update', manual, { status: 'completed' })).toBeNull();
  });
});
