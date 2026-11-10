/**
 * `shipGatePreflight` — the ONE call `callPreflight` makes before the human confirm gate
 * (PRD 45 §4.5). Inert without a git port; refuses a gated publish on failing evidence or
 * no independent review; hands the approval prompt its evidence line on a pass.
 */
import { describe, expect, it, vi } from 'vitest';
import { createEvidenceLedger, type CheckRecord } from '@builderforce/run-guards';
import { shipGateAdvisory, shipGatePreflight } from './shipGates';
import type { BrainRunContext } from './brainRunContext';
import type { GitPort, ReviewerPort, VerifierPort } from './runTypes';

const FILE = '/repo/src/a.ts';

const git = (over: Partial<Awaited<ReturnType<GitPort['outgoing']>>> = {}): GitPort => ({
  outgoing: async () => ({ files: [{ absPath: FILE, hash: 'h1', isNew: false, deleted: false }], diffHash: 'diff-1', baseBranch: true, diff: 'DIFF TEXT', ...over }),
});

const verifier = (outcome: CheckRecord['outcome']): VerifierPort => ({
  diagnostics: async () => null,
  full: async (paths) => new Map(paths.map((p) => [p, [{ kind: 'typecheck' as const, name: 'tsc', outcome, exitCode: outcome === 'fail' ? 2 : 0, findings: [], at: 1 }]])),
});

const approving = (model = 'reviewer-model'): ReviewerPort & { review: ReturnType<typeof vi.fn> } => ({
  review: vi.fn(async () => ({ reviewerModel: model, verdict: 'approved' as const, diffHash: 'diff-1', findings: [] })),
});

const runWith = (req: Partial<BrainRunContext['req']>): BrainRunContext =>
  ({ req, evidence: createEvidenceLedger(), c: { authorModels: new Set(['author-model']), shipReviews: [] } }) as unknown as BrainRunContext;

const PUSH = { allowBaseBranch: true };

describe('shipGatePreflight', () => {
  it('is inert without a git port — every call proceeds exactly as before', async () => {
    const run = runWith({ verifier: verifier('fail'), reviewer: approving() });
    expect(await shipGatePreflight(run, 'git_push', PUSH)).toEqual({});
    expect(await shipGatePreflight(run, 'open_pull_request', {})).toEqual({});
    expect(await shipGatePreflight(run, 'builtin_reviews_record', { taskId: 1, verdict: 'complete' })).toEqual({});
    expect(await shipGateAdvisory(run, 'run_command', { command: 'git commit -am x && git push' }, { ok: true })).toBeNull();
  });

  it('does not gate a non-base-branch push or an ungated tool', async () => {
    const run = runWith({ git: git({ baseBranch: false }), verifier: verifier('fail') });
    expect(await shipGatePreflight(run, 'git_push', {})).toEqual({});
    expect(await shipGatePreflight(run, 'git_push', PUSH)).toEqual({});
    expect(await shipGatePreflight(run, 'read_file', { path: FILE })).toEqual({});
  });

  it('refuses a base-branch push on failing evidence without spending a review', async () => {
    const reviewer = approving();
    const gate = await shipGatePreflight(runWith({ git: git(), verifier: verifier('fail'), reviewer }), 'git_push', PUSH);
    expect('refusal' in gate && gate.refusal.ok).toBe(false);
    expect(reviewer.review).not.toHaveBeenCalled();
  });

  it('gates open_pull_request even off the base branch', async () => {
    const gate = await shipGatePreflight(runWith({ git: git({ baseBranch: false }), verifier: verifier('fail') }), 'open_pull_request', {});
    expect('refusal' in gate).toBe(true);
  });

  it('hands the reviewer the real diff, and the prompt "checks passed · reviewed by <model>"', async () => {
    const reviewer = approving();
    const run = runWith({ git: git(), verifier: verifier('pass'), reviewer });
    // The fake verifier records typecheck only, so the diagnostics + test checks are reported unavailable (OD-3), never as verified.
    expect(await shipGatePreflight(run, 'git_push', PUSH)).toEqual({ evidence: 'checks passed · 2 checks could not run here (not verified) · reviewed by reviewer-model' });
    expect(reviewer.review).toHaveBeenCalledWith(expect.objectContaining({ diff: 'DIFF TEXT', authorModels: ['author-model'] }));
    // The same diff needs no second review sub-run.
    await shipGatePreflight(run, 'git_push', PUSH);
    expect(reviewer.review).toHaveBeenCalledTimes(1);
  });

  it('refuses a push the reviewer refuses, naming the tool', async () => {
    const reviewer: ReviewerPort = { review: async () => ({ refused: 'add a model' }) };
    const gate = await shipGatePreflight(runWith({ git: git(), verifier: verifier('pass'), reviewer }), 'open_pull_request', {});
    expect(gate).toEqual({ refusal: { ok: false, error: 'open_pull_request refused: add a model' } });
  });

  it('refuses a complete review record until an approved review of the current diff exists, then attaches it', async () => {
    const run = runWith({ git: git(), verifier: verifier('pass'), reviewer: approving() });
    const record = { taskId: 1, verdict: 'complete' } as Record<string, unknown>;
    const before = await shipGatePreflight(run, 'builtin_reviews_record', record);
    expect('refusal' in before && before.refusal.error).toMatch(/no reviewGate-approved independent review/);
    await shipGatePreflight(run, 'git_push', PUSH); // the push gate records the review
    expect(await shipGatePreflight(run, 'builtin_reviews_record', record)).toEqual({});
    expect(record.reviewerRef).toBe('reviewer-model');
    // A gaps verdict is never gated.
    expect(await shipGatePreflight(runWith({ git: git() }), 'builtin_reviews_record', { taskId: 1, verdict: 'gaps' })).toEqual({});
  });

  it('regression: a pull request is diffed against its base, and an empty outgoing set is "not verified", never reviewed', async () => {
    const asked: unknown[] = [];
    const reviewer = approving();
    const port: GitPort = { outgoing: async (_repo, opts) => (asked.push(opts), { files: [], diffHash: 'e', baseBranch: false, diff: '', unavailable: 'no outgoing commits against origin/main' }) };
    const gate = await shipGatePreflight(runWith({ git: port, verifier: verifier('pass'), reviewer }), 'open_pull_request', { title: 't', body: 'b', base: 'develop' });
    expect(asked).toEqual([{ pullRequest: { base: 'develop' } }]);
    expect(gate).toEqual({ evidence: 'not verified: no outgoing commits against origin/main' });
    expect(reviewer.review).not.toHaveBeenCalled();
  });

  it('regression: ticket done is refused BEFORE it runs, only for this run\'s own failing outgoing files', async () => {
    const DONE = { id: 1, status: 'done' };
    const files = [{ absPath: FILE, hash: 'h1', isNew: false, deleted: false }];
    const runFor = (c: Record<string, unknown>) =>
      ({ req: { git: git({ files }), verifier: verifier('fail') }, evidence: createEvidenceLedger(), c: { authorModels: new Set(), shipReviews: [], ...c } }) as unknown as BrainRunContext;
    const refused = await shipGatePreflight(runFor({ codeChanged: true, touchedFiles: ['src/a.ts'] }), 'builtin_tasks_update', DONE);
    expect('refusal' in refused && refused.refusal.error).toMatch(/^CANNOT MARK DONE/);
    // A run that wrote no code, or wrote other files, is never blocked by someone else's commit.
    expect(await shipGatePreflight(runFor({ codeChanged: false, touchedFiles: [] }), 'builtin_tasks_update', DONE)).toEqual({});
    expect(await shipGatePreflight(runFor({ codeChanged: true, touchedFiles: ['src/other.ts'] }), 'builtin_tasks_update', DONE)).toEqual({});
  });

  it('regression: the completion check passes the verifier a short budget', async () => {
    const budgets: unknown[] = [];
    const v: VerifierPort = { diagnostics: async () => null, full: async (paths, opts) => (budgets.push(opts), new Map(paths.map((p) => [p, []]))) };
    const run = { req: { git: git(), verifier: v }, evidence: createEvidenceLedger(), c: { authorModels: new Set(), shipReviews: [], codeChanged: true, touchedFiles: [FILE] } } as unknown as BrainRunContext;
    await shipGatePreflight(run, 'builtin_tasks_update', { id: 1, status: 'done' });
    expect((budgets[0] as { budgetMs: number }).budgetMs).toBeLessThanOrEqual(20_000);
  });

  it('refuses (never throws) when the git port fails on a gated call', async () => {
    const broken: GitPort = { outgoing: async () => { throw new Error('not a git repository'); } };
    const gate = await shipGatePreflight(runWith({ git: broken }), 'git_push', PUSH);
    expect('refusal' in gate && gate.refusal.error).toMatch(/not a git repository/);
  });
});
