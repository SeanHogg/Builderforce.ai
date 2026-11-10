import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  merge: vi.fn(async () => ({ ok: true as const, merged: true, sha: 'abc1234' })),
  markMerged: vi.fn(async () => null),
  openPr: vi.fn(),
  step: vi.fn(),
  toolEvent: vi.fn(async () => undefined),
}));

vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../skills/skillReflection', () => ({ recordRunReflection: vi.fn(async () => undefined) }));
vi.mock('../repos/mergeBranchToBase', () => ({
  mergeBranchToBase: h.merge, cloudAutoMergeEnabled: () => true, cloudAutoMergeRequiresGreen: () => false,
}));
vi.mock('../repos/recordPullRequestRow', () => ({
  recordPullRequestRow: vi.fn(async () => ({ id: 'row-1' })), markPullRequestMergedById: h.markMerged,
}));
vi.mock('../repos/recordTaskPullRequest', () => ({ recordTaskPullRequest: vi.fn(async () => ({ id: 'row-1' })) }));
vi.mock('../checks/publishTaskVerdict', () => ({ publishAgentRunVerdict: vi.fn(async () => undefined) }));
vi.mock('../repos/postPrComment', () => ({ postRepoPrComment: vi.fn(async () => undefined) }));
vi.mock('../repos/openTaskPullRequest', () => ({
  openClaimedPullRequest: h.openPr, openTaskRepoSetPullRequests: vi.fn(async () => []),
}));
vi.mock('@builderforce/agent-run', () => ({ RUN_CANCELLED_NOTICE: 'cancelled' }));
vi.mock('../llm/projectEvermind', () => ({ contributeTextToProjectEverminds: vi.fn(async () => undefined) }));
vi.mock('./outcomeScore', () => ({ finalizeLearnWeight: () => 1, runProducedOutput: () => 'yes' }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: h.toolEvent }));
vi.mock('./adoptRunDraftPr', () => ({ adoptRunDraftPr: vi.fn(async () => null) }));
vi.mock('./runPullRequestText', () => ({ runPullRequestText: vi.fn(() => '') }));
vi.mock('./runRollback', () => ({ recordRunRollbackSnapshot: vi.fn(async () => undefined) }));
vi.mock('./runBranchTeardown', () => ({ teardownRunBranch: vi.fn(async () => undefined) }));
vi.mock('../../env', () => ({ resolveAppBaseUrl: () => 'https://app.test' }));
vi.mock('../provenance/finishClaimService', () => ({ recordTypedExecutionClaim: vi.fn(async () => ({ ok: true })) }));
vi.mock('../agentIdentity/agentRunIdentity', () => ({ revokeRunPrincipal: vi.fn(async () => undefined) }));
vi.mock('../trust/trustService', () => ({ inspectOutboundContent: vi.fn(async () => ({ ok: false })) }));
vi.mock('../security/pullRequestSecurityStep', () => ({ runPullRequestSecurityStep: h.step }));
vi.mock('../security/prSecurityGate', () => ({
  describeSecurityBlock: (v: { reasons: Array<{ message: string }> }) => `held for security: ${v.reasons.map((r) => r.message).join('; ')}`,
}));

import { finalizeCloudRun } from './cloudFinalize';

const db = { update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }) } as never;
const repoCtx = {
  provider: 'github', host: null, owner: 'acme', repo: 'api', token: 't', branch: 'builderforce/task-7', base: 'main',
  repoId: 'repo-1', segmentId: 'seg', projectId: 3,
};
const args = {
  tenantId: 1, cloudAgentRef: 'agent-1', executionId: 42, taskRow: { id: 7, title: 'Fix' }, agentLabel: 'Coder',
  repoCtx, writtenPaths: new Set(['a.ts']), finalOutput: 'done', cancelled: false,
};

beforeEach(() => { h.merge.mockClear(); h.markMerged.mockClear(); h.step.mockReset(); h.openPr.mockReset(); });

describe('finalizeCloudRun - the security gate in front of an immediate auto-merge', () => {
  it('NEVER merges when the PR failed to open (pr.ok === false)', async () => {
    h.openPr.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'GitHub 422' });
    const out = await finalizeCloudRun({} as never, db, args);
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.step).not.toHaveBeenCalled(); // nothing to scan: there is no PR
    expect(out.ok).toBeDefined();
  });

  it('does not merge when the step blocks (an open blocker / incomplete scan), and records why', async () => {
    h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
    h.step.mockResolvedValue({ verdict: { allow: false, reasons: [{ code: 'scan_skipped', scanType: 'SAST', message: 'SAST scan was skipped' }], headSha: 'h' }, scanStatuses: [], incidentsOpened: 0 });
    await finalizeCloudRun({} as never, db, args);
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.toolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'merge_blocked_security' }));
  });

  it('merges only when the step allows (control: the mocks really reach the merge)', async () => {
    h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
    h.step.mockResolvedValue({ verdict: { allow: true, headSha: 'abc123def456' }, scanStatuses: [], incidentsOpened: 0 });
    await finalizeCloudRun({} as never, db, args);
    expect(h.merge).toHaveBeenCalledOnce();
    // the merge is pinned to the commit the gate verified
    expect(h.merge).toHaveBeenCalledWith(expect.objectContaining({ expectedHeadSha: 'abc123def456' }));
    expect(h.markMerged).toHaveBeenCalledOnce();
  });
});
