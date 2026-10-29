/**
 * cloudFinishPorts — the couplings the cloud binds the agent's finish gates with (PRD 35 WS3). The gates themselves are
 * the agent's and are proven in `packages/agent-run/test/finish/finish.test.ts` (this file's earlier cases moved there,
 * over these same ports); what the cloud owns is that each port reaches the right dependency with the right arguments.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  verify: vi.fn(async (..._a: unknown[]) => ({ ok: true, checked: [], skipped: [], errors: [] })),
  poll: vi.fn(async (..._a: unknown[]) => ({ status: 'pending', sha: 'abcdef1234', count: 1, summary: 'pending', failed: [] as string[] })),
  scan: vi.fn(async (..._a: unknown[]) => ({ flagged: [] })),
  claim: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  record: vi.fn(async (..._a: unknown[]) => undefined),
  children: vi.fn(async (..._a: unknown[]) => 'wait for your sub-agents' as string | null),
  absorb: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock('../../repos/verifyWrittenFiles', () => ({ verifyWrittenFiles: h.verify }));
vi.mock('../../ci/pollCommitCiStatus', async (orig) => ({ ...(await orig<Record<string, unknown>>()), pollBranchCi: h.poll }));
vi.mock('../../repos/scanForPlaceholders', () => ({ scanWrittenForPlaceholders: h.scan }));
vi.mock('../../provenance/finishClaimService', () => ({ recordCodeCompletionClaim: h.claim }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../cloudChildRuns', () => ({ liveChildrenFinishBlock: h.children, absorbChildWrites: h.absorb }));

import { cloudFinishPorts } from './finishGates';

const repoCtx = { branch: 'bf/task-1', base: 'main', owner: 'o', repo: 'r' } as never;
const evt = { tenantId: 1, executionId: 9 };
const db = { tag: 'db' } as never;

beforeEach(() => vi.clearAllMocks());

describe('cloudFinishPorts', () => {
  it('validates the written files on the ticket branch, scans them for stubs, and polls the branch CI with the run\'s counters', async () => {
    const ports = cloudFinishPorts({ db, evt, repoCtx, delegated: false });
    ports.beginAttempt!();
    await ports.verify!(['src/a.ts']);
    expect(h.verify).toHaveBeenCalledWith(expect.objectContaining({ ref: 'bf/task-1' }), new Set(['src/a.ts']), expect.any(Function));
    await ports.scanPlaceholders!(['src/a.ts']);
    expect(h.scan).toHaveBeenCalledWith(expect.objectContaining({ ref: 'bf/task-1' }), new Set(['src/a.ts']));
    const decision = await ports.pollBranchCi!({ pendingBlocks: 0, failureBlocks: 0 });
    expect(decision).toMatchObject({ pendingBlocks: 1, ciVerified: false });
    expect(decision.block).toMatch(/still running/);
  });

  it('shares ONE read memo between the child-write re-hash and the static validation within an attempt, and starts afresh on the next', async () => {
    const ports = cloudFinishPorts({ db, evt, repoCtx, delegated: true, writtenHashes: new Map() });
    ports.beginAttempt!();
    await ports.absorbChildWrites!(new Set(['a']));
    await ports.verify!(['a']);
    const absorbReader = (h.absorb.mock.calls.at(-1) as unknown as unknown[])[6];
    const verifyReader = (h.verify.mock.calls.at(-1) as unknown as unknown[])[2];
    expect(verifyReader).toBe(absorbReader);
    // The model edits files between a blocked finish and the next attempt: a later attempt never reuses the memo.
    ports.beginAttempt!();
    await ports.verify!(['a']);
    expect((h.verify.mock.calls.at(-1) as unknown as unknown[])[2]).not.toBe(absorbReader);
  });

  it('an unbound run has no repository couplings and is not held to the deliverable gates', () => {
    const ports = cloudFinishPorts({ db, evt, repoCtx: null, delegated: false });
    expect(ports.bound).toBe(false);
    expect(ports.verify).toBeUndefined();
    expect(ports.pollBranchCi).toBeUndefined();
    expect(ports.scanPlaceholders).toBeUndefined();
  });

  it('asks the child runs and the claim ledger for THIS execution, and records every block on the timeline', async () => {
    const writtenHashes = new Map([['src/a.ts', 'h']]);
    const ports = cloudFinishPorts({ db, evt, repoCtx, delegated: true, writtenHashes });
    ports.beginAttempt!();
    expect(ports.delegated).toBe(true);
    expect(await ports.liveChildren!()).toBe('wait for your sub-agents');
    expect(h.children).toHaveBeenCalledWith(db, 1, 9);
    const paths = new Set(['a']);
    await ports.absorbChildWrites!(paths);
    // The written set AND the run's file hashes reach the child-write absorption; the trailing argument is the
    // per-attempt read memo it shares with verification.
    expect(h.absorb).toHaveBeenCalledWith(db, 1, 9, repoCtx, paths, writtenHashes, expect.any(Function));
    await ports.recordClaim!('Implemented it.', ['src/a.ts']);
    expect(h.claim).toHaveBeenCalledWith(db, { tenantId: 1, executionId: 9, statement: 'Implemented it.' });
    await ports.onBlocked!('placeholders', 'block', { files: [] }, 'Blocked finish: src/a.ts');
    expect(h.record).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'finish.blocked', detail: { reason: 'placeholders', files: [] }, result: 'Blocked finish: src/a.ts' }));
  });
});
