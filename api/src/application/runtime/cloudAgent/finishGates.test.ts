import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  poll: vi.fn(),
  scan: vi.fn(),
  claim: vi.fn(),
  record: vi.fn(async () => undefined),
}));
vi.mock('../../repos/verifyWrittenFiles', () => ({ verifyWrittenFiles: h.verify }));
vi.mock('../../ci/pollCommitCiStatus', async (orig) => ({ ...(await orig<Record<string, unknown>>()), pollBranchCi: h.poll }));
vi.mock('../../repos/scanForPlaceholders', () => ({ scanWrittenForPlaceholders: h.scan }));
vi.mock('../../provenance/finishClaimService', () => ({ recordCodeCompletionClaim: h.claim }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
const absorb = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../cloudChildRuns', () => ({ liveChildrenFinishBlock: vi.fn(async () => null), absorbChildWrites: absorb }));

import { evaluateFinishGates, finishGateSnapshot, initialFinishGateState, isInconclusiveFinishBlock, type FinishGateArgs } from './finishGates';

const repoCtx = { branch: 'bf/task-1', base: 'main', owner: 'o', repo: 'r' } as never;
const ci = (status: string) => ({ status, sha: 'abcdef1234', count: 1, summary: status, failed: status === 'failure' ? ['build'] : [] });

function args(over: Partial<FinishGateArgs> = {}): FinishGateArgs {
  return {
    db: {} as never,
    evt: { tenantId: 1, executionId: 9 },
    repoCtx,
    writtenPaths: new Set(['src/a.ts']),
    requiredSignoff: undefined,
    delegated: false,
    summary: 'Implemented the change.',
    output: '',
    gates: initialFinishGateState(undefined, false),
    enterVerify: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  h.verify.mockResolvedValue({ ok: true, checked: ['src/a.ts'], skipped: [], errors: [] });
  h.poll.mockResolvedValue(ci('success'));
  h.scan.mockResolvedValue({ flagged: [] });
  h.claim.mockResolvedValue({ ok: true });
  h.record.mockClear();
});

describe('evaluateFinishGates', () => {
  it('hands a delegated run’s written set AND its file hashes to the child-write absorption', async () => {
    const writtenHashes = new Map([['src/a.ts', 'h']]);
    const a = args({ delegated: true, writtenHashes });
    await evaluateFinishGates(a);
    // The trailing argument is the per-attempt read memo it shares with verification.
    expect(absorb).toHaveBeenCalledWith(a.db, 1, 9, repoCtx, a.writtenPaths, writtenHashes, expect.any(Function));
    // ...the SAME reader instance, so each path is fetched once per attempt, not once per consumer.
    const absorbReader = (absorb.mock.calls.at(-1) as unknown as unknown[])[6];
    const verifyReader = (h.verify.mock.calls.at(-1) as unknown as unknown[])[2];
    expect(verifyReader).toBe(absorbReader);
  });

  it('absorbs nothing for a run with no children', async () => {
    absorb.mockClear();
    await evaluateFinishGates(args());
    expect(absorb).not.toHaveBeenCalled();
  });

  it('ships a verified finish, enters verify and marks CI green', async () => {
    const a = args();
    expect(await evaluateFinishGates(a)).toEqual({ block: null });
    expect(a.enterVerify).toHaveBeenCalled();
    expect(a.gates.ciVerified).toBe(true);
  });

  it('names a source-quality block', async () => {
    h.verify.mockResolvedValue({ ok: false, checked: [], skipped: [], errors: [{ path: 'src/a.ts', line: 3, message: 'Unexpected token' }] });
    const v = await evaluateFinishGates(args());
    expect(v.reason).toBe('source_quality');
    expect(v.block).toContain('src/a.ts:3');
  });

  it('tells a pending CI block (not the model\'s failure) from a red one', async () => {
    h.poll.mockResolvedValue(ci('pending'));
    const pending = await evaluateFinishGates(args());
    expect(pending.reason).toBe('branch_ci_pending');
    expect(isInconclusiveFinishBlock(pending.reason)).toBe(true);
    h.poll.mockResolvedValue(ci('failure'));
    const red = await evaluateFinishGates(args());
    expect(red.reason).toBe('branch_ci');
    expect(isInconclusiveFinishBlock(red.reason)).toBe(false);
    // The timeline keeps its one reason for both.
    expect(h.record.mock.calls.map((c) => (c as unknown as [unknown, { detail: { reason: string } }])[1].detail.reason)).toEqual(['branch_ci', 'branch_ci']);
  });

  it('blocks an unrun-verification claim once', async () => {
    h.poll.mockResolvedValue(ci('none'));
    const a = args({ summary: 'All tests passed and the build is green.' });
    expect((await evaluateFinishGates(a)).reason).toBe('honesty');
    expect((await evaluateFinishGates(a)).block).toBeNull();
  });

  it('requires the reviewer verdict before anything else', async () => {
    const v = await evaluateFinishGates(args({ requiredSignoff: { roleKey: 'code-reviewer' } }));
    expect(v.reason).toBe('review_verdict_missing');
  });

  it('carries its counters through a durable snapshot', () => {
    const g = initialFinishGateState({ placeholderBlocks: 2, ciPendingBlocks: 1 }, true);
    expect(g.noDeliverableBlocked).toBe(true);
    expect(finishGateSnapshot(g)).toEqual({ noDeliverableBlocked: true, reviewVerdictRecorded: false, placeholderBlocks: 2, ciPendingBlocks: 1, ciFailureBlocks: 0 });
  });
});
