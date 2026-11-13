/**
 * `shipGatePreflight` — the ONE call `callPreflight` makes before the human confirm gate
 * (PRD 45 §4.5). Inert without a git port; refuses a gated publish on failing evidence or
 * no independent review; hands the approval prompt its evidence line on a pass.
 */
import { describe, expect, it, vi } from 'vitest';
import { createEvidenceLedger, type CheckRecord } from '@builderforce/run-guards';
import { COMPLETION_GATE_BUDGET_MS, shipGateAdvisory, shipGatePreflight } from './shipGates';
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

/** A run cell the completion gate can trace onto (`pushTrace` publishes a snapshot). */
const cell = (c: Record<string, unknown>) => ({ authorModels: new Set(), shipReviews: [], trace: [], runTraceFrom: 0, listeners: new Set(), ...c });

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

  it('regression: a complete review record with only ONE model served names the model — the review can never be independent, so "push" is not the answer (chat #74528)', async () => {
    // Every turn was served by one model, so the review sub-run could never be by a
    // different model. Telling the agent to "push so the host runs the review" was a lie.
    const run = runWith({ git: git(), verifier: verifier('pass') }); // authorModels: ['author-model'] only
    const gate = await shipGatePreflight(run, 'builtin_reviews_record', { taskId: 1, verdict: 'complete' });
    expect('refusal' in gate && gate.refusal.error).toMatch(/only ONE model \(author-model\)/);
    expect('refusal' in gate && gate.refusal.error).toMatch(/pushing cannot create it/);
  });

  it('regression: a model cannot mark the run\'s OWN delta ticket done with no review / no verification (#6537)', async () => {
    // `builtin_tasks_update {status:"done"}` succeeded right after the review was refused.
    // The delta ticket holds the SAME evidence rule the host close-out uses.
    const run = ({ req: { git: git() }, evidence: createEvidenceLedger(),
      placeholderLedger: { outstanding: () => [] },
      c: { authorModels: new Set(['author-model']), shipReviews: [], deltaTicketId: 77, runId: 'r', touchedFiles: [FILE], deltaRecordedFiles: [], trace: [], listeners: new Set(), codeChanged: true } }) as unknown as BrainRunContext;
    // No verification recorded → refused.
    let gate = await shipGatePreflight(run, 'builtin_tasks_update', { id: 77, status: 'done' });
    expect('refusal' in gate && gate.refusal.error).toMatch(/no passing verification/);
    // Verification passes but there is no reviewGate-approved review of the current diff → still refused.
    run.evidence.record(FILE, 'h1', { kind: 'typecheck', name: 'tsc', outcome: 'pass', exitCode: 0, findings: [], at: 1 });
    run.evidence.record(FILE, 'h1', { kind: 'diagnostics', name: 'lsp', outcome: 'pass', exitCode: null, findings: [], at: 2 });
    run.evidence.record(FILE, 'h1', { kind: 'test', name: 'vitest', outcome: 'pass', exitCode: 0, findings: [], at: 3 });
    gate = await shipGatePreflight(run, 'builtin_tasks_update', { id: 77, status: 'done' });
    expect('refusal' in gate && gate.refusal.error).toMatch(/delta ticket/);
    // A NON-delta ticket id keeps current behaviour (not gated by the delta rule).
    expect(await shipGatePreflight(run, 'builtin_tasks_update', { id: 1, status: 'done' })).toEqual({});
  });

  it('regression: a pull request is diffed against its base, and an empty outgoing set is REFUSED as not verified (never a pass), never reviewed', async () => {
    const asked: unknown[] = [];
    const reviewer = approving();
    const port: GitPort = { outgoing: async (_repo, opts) => (asked.push(opts), { files: [], diffHash: 'e', baseBranch: false, diff: '', unavailable: 'no outgoing commits against origin/main' }) };
    const gate = await shipGatePreflight(runWith({ git: port, verifier: verifier('pass'), reviewer }), 'open_pull_request', { title: 't', body: 'b', base: 'develop' });
    expect(asked).toEqual([{ pullRequest: { base: 'develop' } }]);
    expect('refusal' in gate && gate.refusal.error).toMatch(/^open_pull_request refused: not verified — no outgoing commits against origin\/main/);
    expect(reviewer.review).not.toHaveBeenCalled();
  });

  it('regression: a base-branch push whose outgoing change cannot be computed is refused, not passed', async () => {
    const gate = await shipGatePreflight(runWith({ git: git({ files: [], diff: '', unavailable: 'the branch has no upstream' }), verifier: verifier('pass') }), 'git_push', PUSH);
    expect('refusal' in gate && gate.refusal.error).toMatch(/not verified — the branch has no upstream/);
  });

  it('regression: ticket done is refused BEFORE it runs, only for this run\'s own failing outgoing files', async () => {
    const DONE = { id: 1, status: 'done' };
    const files = [{ absPath: FILE, hash: 'h1', isNew: false, deleted: false }];
    const runFor = (c: Record<string, unknown>) =>
      ({ req: { git: git({ files }), verifier: verifier('fail') }, evidence: createEvidenceLedger(), c: cell(c) }) as unknown as BrainRunContext;
    const refused = await shipGatePreflight(runFor({ codeChanged: true, touchedFiles: ['src/a.ts'] }), 'builtin_tasks_update', DONE);
    expect('refusal' in refused && refused.refusal.error).toMatch(/^CANNOT MARK DONE/);
    // A run that wrote no code, or wrote other files, is never blocked by someone else's commit.
    expect(await shipGatePreflight(runFor({ codeChanged: false, touchedFiles: [] }), 'builtin_tasks_update', DONE)).toEqual({});
    expect(await shipGatePreflight(runFor({ codeChanged: true, touchedFiles: ['src/other.ts'] }), 'builtin_tasks_update', DONE)).toEqual({});
  });

  it('regression: the completion check passes the verifier a short budget', async () => {
    const budgets: unknown[] = [];
    const v: VerifierPort = { diagnostics: async () => null, full: async (paths, opts) => (budgets.push(opts), new Map(paths.map((p) => [p, []]))) };
    const run = { req: { git: git(), verifier: v }, evidence: createEvidenceLedger(), c: cell({ codeChanged: true, touchedFiles: [FILE] }) } as unknown as BrainRunContext;
    await shipGatePreflight(run, 'builtin_tasks_update', { id: 1, status: 'done' });
    expect((budgets[0] as { budgetMs: number }).budgetMs).toBeLessThanOrEqual(20_000);
  });

  describe('regression: ticket done FAILS CLOSED (was: any git / verifier error, timeout or unavailability let it through)', () => {
    const DONE = { id: 1, status: 'done' };
    const doneRun = (req: Partial<BrainRunContext['req']>) =>
      ({ req, evidence: createEvidenceLedger(), c: cell({ codeChanged: true, touchedFiles: [FILE] }) }) as unknown as BrainRunContext;
    const traced = (run: BrainRunContext) => (run.c.trace as Array<{ label: string; args?: { outcome?: string } }>).filter((e) => e.label === 'tools.completion_gate');

    it('refuses and traces when the git port throws', async () => {
      const run = doneRun({ git: { outgoing: async () => { throw new Error('index.lock exists'); } }, verifier: verifier('pass') });
      const gate = await shipGatePreflight(run, 'builtin_tasks_update', DONE);
      expect('refusal' in gate && gate.refusal.error).toMatch(/^CANNOT MARK DONE.*index\.lock exists/);
      expect(traced(run).map((e) => e.args?.outcome)).toEqual(['error']);
    });

    it('refuses when the verifier throws', async () => {
      const broken: VerifierPort = { diagnostics: async () => null, full: async () => { throw new Error('tsc crashed'); } };
      const gate = await shipGatePreflight(doneRun({ git: git(), verifier: broken }), 'builtin_tasks_update', DONE);
      expect('refusal' in gate && gate.refusal.error).toMatch(/tsc crashed/);
    });

    it('refuses when the outgoing change cannot be computed off the base branch', async () => {
      const run = doneRun({ git: git({ files: [], baseBranch: false, unavailable: 'the branch has no upstream' }), verifier: verifier('pass') });
      const gate = await shipGatePreflight(run, 'builtin_tasks_update', DONE);
      expect('refusal' in gate && gate.refusal.error).toMatch(/the branch has no upstream/);
      expect(traced(run).map((e) => e.args?.outcome)).toEqual(['unavailable']);
    });

    it('allows (traced) when the base branch has nothing outgoing — the work already landed', async () => {
      const run = doneRun({ git: git({ files: [], baseBranch: true, unavailable: 'no outgoing commits against @{u}' }), verifier: verifier('pass') });
      expect(await shipGatePreflight(run, 'builtin_tasks_update', DONE)).toEqual({});
      expect(traced(run).map((e) => e.args?.outcome)).toEqual(['clear']);
    });

    it('refuses when the check runs past its budget', async () => {
      vi.useFakeTimers();
      try {
        const hanging: GitPort = { outgoing: () => new Promise(() => undefined) };
        const run = doneRun({ git: hanging, verifier: verifier('pass') });
        const pending = shipGatePreflight(run, 'builtin_tasks_update', DONE);
        await vi.advanceTimersByTimeAsync(COMPLETION_GATE_BUDGET_MS + 1);
        const gate = await pending;
        expect('refusal' in gate && gate.refusal.error).toMatch(/did not finish within 20s/);
        expect(traced(run).map((e) => e.args?.outcome)).toEqual(['timeout']);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('refuses (never throws) when the git port fails on a gated call', async () => {
    const broken: GitPort = { outgoing: async () => { throw new Error('not a git repository'); } };
    const gate = await shipGatePreflight(runWith({ git: broken }), 'git_push', PUSH);
    expect('refusal' in gate && gate.refusal.error).toMatch(/not a git repository/);
  });
});
