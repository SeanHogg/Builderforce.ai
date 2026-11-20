import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bind: vi.fn(async (..._a: unknown[]) => false),
  existingPr: vi.fn(async (..._a: unknown[]) => null as unknown),
  commits: [{ sha: 'abc123', message: 'Update a.ts — task #7 · run #42 (Coder)', authorName: null }] as unknown[],
  voidGrant: vi.fn(async (..._a: unknown[]) => undefined),
  markMerged: vi.fn(async () => null),
  publishVerdict: vi.fn(async (..._a: unknown[]) => undefined),
  openPr: vi.fn(),
  step: vi.fn(),
  toolEvent: vi.fn(async () => undefined),
}));

vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../observability/caughtErrorReporter', () => ({
  reportCaughtError: vi.fn(),
  reportedFallback: <T,>(fallback: T) => () => fallback,
}));
vi.mock('../skills/skillReflection', () => ({ recordRunReflection: vi.fn(async () => undefined) }));
vi.mock('../repos/recordPullRequestRow', () => ({
  recordPullRequestRow: vi.fn(async () => ({ id: 'row-1' })), markPullRequestMergedById: h.markMerged,
  findOpenPullRequestByTask: h.existingPr,
}));
vi.mock('../repos/recordTaskPullRequest', () => ({ recordTaskPullRequest: vi.fn(async () => ({ id: 'row-1' })) }));
vi.mock('../checks/publishTaskVerdict', () => ({ publishAgentRunVerdict: h.publishVerdict }));
vi.mock('../repos/postPrComment', () => ({ postRepoPrComment: vi.fn(async () => undefined) }));
vi.mock('../repos/openTaskPullRequest', () => ({
  openClaimedPullRequest: h.openPr, openTaskRepoSetPullRequests: vi.fn(async () => []),
}));
vi.mock('@builderforce/agent-run', () => ({ RUN_CANCELLED_NOTICE: 'cancelled' }));
vi.mock('../llm/projectEvermind', () => ({ contributeTextToProjectEverminds: vi.fn(async () => undefined) }));
vi.mock('./outcomeScore', () => ({ finalizeLearnWeight: () => 1, runProducedOutput: () => 'yes' }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: h.toolEvent }));
vi.mock('./mergeGrants', () => ({ bindGrantToThisRunsPr: h.bind, voidMergeGrant: h.voidGrant }));
vi.mock('./adoptRunDraftPr', () => ({ adoptRunDraftPr: vi.fn(async () => null) }));
vi.mock('./runPullRequestText', () => ({ runPullRequestText: vi.fn(() => '') }));
// The branch listing finalize already makes — handed back so the grant can be pinned to the run's own last commit.
vi.mock('./runRollback', () => ({
  recordRunRollbackSnapshot: vi.fn(async (_db: unknown, a: { onListed?: (c: unknown[]) => void }) => { a.onListed?.(h.commits); return null; }),
}));
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

/** Every env a deployment could carry, including the retired auto-merge switches set every way. */
const ENVS: Array<Record<string, string>> = [
  {},
  { CLOUD_AUTOMERGE_ENABLED: '1' },
  { CLOUD_AUTOMERGE_ENABLED: 'true', CLOUD_AUTOMERGE_REQUIRE_GREEN: '0' },
  { CLOUD_AUTOMERGE_ENABLED: '1', CLOUD_AUTOMERGE_REQUIRE_GREEN: 'off' },
  { CLOUD_AUTOMERGE_REQUIRE_GREEN: '1' },
];

beforeEach(() => {
  h.markMerged.mockClear(); h.publishVerdict.mockClear(); h.step.mockReset(); h.openPr.mockReset(); h.toolEvent.mockClear();
  h.bind.mockReset().mockResolvedValue(false); h.voidGrant.mockClear(); h.existingPr.mockReset().mockResolvedValue(null);
});

describe('finalizeCloudRun calls no merge endpoint (the sweep is the single merge writer)', () => {
  it('with every check passing and the retired auto-merge env set, no provider merge request leaves finalize', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
      h.step.mockResolvedValue({ verdict: { allow: true, headSha: 'abc' }, scanStatuses: [], incidentsOpened: 0 });
      await finalizeCloudRun({ CLOUD_AUTOMERGE_ENABLED: '1', CLOUD_AUTOMERGE_REQUIRE_GREEN: '0' } as never, db, args);
      const merges = fetchSpy.mock.calls.filter((c) => /\/merges?\b/.test(String((c as unknown[])[0])));
      expect(merges).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('finalizeCloudRun — a person\'s merge grant (PRD 48 §4.6)', () => {
  it('binds the grant to the PR THIS run opened, with the run\'s own commits to pin it to', async () => {
    h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
    h.step.mockResolvedValue({ verdict: { allow: true, headSha: 'abc123' }, scanStatuses: [], incidentsOpened: 0 });
    h.bind.mockResolvedValue(true);
    await finalizeCloudRun({} as never, db, args);
    expect(h.bind).toHaveBeenCalledWith({}, db, {
      tenantId: 1, executionId: 42, taskId: 7, prRowId: 'row-1', headSha: 'abc123', runCommits: h.commits,
    });
    expect(h.voidGrant).not.toHaveBeenCalled();
  });

  it('RE-RUN: the ticket\'s PR already exists (claim lost) — binds THAT PR instead of voiding "no pull request"', async () => {
    h.openPr.mockResolvedValue({ ok: false, claimLost: true });
    h.existingPr.mockResolvedValue({ id: 'existing-pr', status: 'open' });
    h.bind.mockResolvedValue(true);
    await finalizeCloudRun({} as never, db, args);
    expect(h.existingPr).toHaveBeenCalledWith(db, 1, 7, 'builderforce/task-7');
    expect(h.bind).toHaveBeenCalledWith({}, db, expect.objectContaining({ prRowId: 'existing-pr', headSha: null, runCommits: h.commits }));
    expect(h.voidGrant).not.toHaveBeenCalled();
  });

  it('voids the grant when the run ends without its PR', async () => {
    h.openPr.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'GitHub 422' });
    await finalizeCloudRun({} as never, db, args);
    expect(h.bind).not.toHaveBeenCalled();
    expect(h.voidGrant).toHaveBeenCalledWith(db, { tenantId: 1, executionId: 42, reason: 'no_pull_request' });
  });

  it('voids the grant when the run was cancelled', async () => {
    await finalizeCloudRun({} as never, db, { ...args, cancelled: true });
    expect(h.voidGrant).toHaveBeenCalledWith(db, { tenantId: 1, executionId: 42, reason: 'cancelled' });
  });
});

describe('finalizeCloudRun — the security step on the run\'s pull request', () => {
  it('a run that wrote code but whose PR failed to open FAILS, with the reason; nothing is scanned', async () => {
    h.openPr.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'GitHub 422' });
    const out = await finalizeCloudRun({} as never, db, args);
    expect(h.step).not.toHaveBeenCalled(); // nothing to scan: there is no PR
    expect(out.ok).toBe(false);
    expect(out.output).toContain('No pull request was opened: GitHub 422');
    expect(h.publishVerdict).toHaveBeenCalledWith(expect.anything(), db, 1, 7, expect.objectContaining({ outcome: 'failed' }));
    expect(h.toolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'pr_skipped' }));
  });

  it('a cancelled run whose PR did not open is not failed by finalize', async () => {
    h.openPr.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'GitHub 422' });
    const out = await finalizeCloudRun({} as never, db, { ...args, cancelled: true });
    expect(out.ok).toBe(true);
  });

  it('runs the security step on an opened PR, so the merge sweep finds a verdict for its head', async () => {
    h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
    h.step.mockResolvedValue({ verdict: { allow: true, headSha: 'abc123def456' }, scanStatuses: [], incidentsOpened: 0 });
    await finalizeCloudRun({} as never, db, args);
    expect(h.step).toHaveBeenCalledOnce();
    expect(h.toolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'security_scan' }));
  });
});

describe('finalizeCloudRun — a run opens its PR and ends; it never merges (PRD 48 §4.3)', () => {
  for (const env of ENVS) {
    for (const allow of [true, false]) {
      it(`does not merge with env ${JSON.stringify(env)} and a security verdict that ${allow ? 'allows' : 'blocks'}`, async () => {
        h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
        h.step.mockResolvedValue({
          verdict: allow ? { allow: true, headSha: 'abc' } : { allow: false, reasons: [{ code: 'scan_skipped', message: 'SAST scan was skipped' }], headSha: 'abc' },
          scanStatuses: [], incidentsOpened: 0,
        });
        const out = await finalizeCloudRun(env as never, db, args);
        expect(h.markMerged).not.toHaveBeenCalled();
        expect(h.toolEvent).not.toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'merge_to_main' }));
        expect(h.toolEvent).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'pr_opened' }));
        // An unmerged PR is the designed outcome, never a failed run.
        expect(out.ok).toBe(true);
        expect(out.output).not.toMatch(/auto-merged/);
      });
    }
  }

  it('regression: chat #157440 — merge authority is the project setting, not an env var', async () => {
    // The env that used to make a run squash-merge into main on finish. It is now inert: the
    // run opens the PR and the project's merge sweep (prMergeSweep) decides from its settings.
    h.openPr.mockResolvedValue({ ok: true, number: 9, url: 'https://x/pull/9' });
    h.step.mockResolvedValue({ verdict: { allow: true, headSha: 'abc' }, scanStatuses: [], incidentsOpened: 0 });
    const out = await finalizeCloudRun({ CLOUD_AUTOMERGE_ENABLED: '1', CLOUD_AUTOMERGE_REQUIRE_GREEN: '0' } as never, db, { ...args, finalOutput: '' });
    expect(h.markMerged).not.toHaveBeenCalled();
    expect(h.toolEvent).not.toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'merge_to_main' }));
    expect(out.output).toContain("the project's merge settings decide");
  });
});
