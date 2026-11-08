/**
 * The early draft PR ACROSS durable ticks: each tick builds fresh finish gates, so "already opened" must come
 * from the durable record the ports read, not from a gate instance's memory. Real `draftPrForCi`; the
 * ports are a fake over one shared durable state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  poll: vi.fn(async (..._a: unknown[]) => ({ status: 'none', sha: 'abcdef1234', count: 0, summary: 'none', failed: [] as string[] })),
}));
vi.mock('../../repos/verifyWrittenFiles', () => ({ verifyWrittenFiles: vi.fn() }));
vi.mock('../../ci/pollCommitCiStatus', async (orig) => ({ ...(await orig<Record<string, unknown>>()), pollBranchCi: h.poll }));
vi.mock('../../repos/scanForPlaceholders', () => ({ scanWrittenForPlaceholders: vi.fn() }));
vi.mock('../../provenance/finishClaimService', () => ({ recordCodeCompletionClaim: vi.fn() }));
vi.mock('../cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn() }));
vi.mock('../cloudChildRuns', () => ({ liveChildrenFinishBlock: vi.fn(), absorbChildWrites: vi.fn() }));

import { cloudFinishPorts } from './finishGates';
import type { DraftPrPorts } from '../../ci/draftPrForCi';

const repoCtx = { branch: 'bf/task-1', base: 'main', owner: 'o', repo: 'r' } as never;
const evt = { tenantId: 1, executionId: 9 };
const db = {} as never;

/** One durable "does the platform's draft exist" bit, shared by every tick's ports. */
function durablePorts() {
  const state = { draft: false, opened: 0, workflowReads: 0 };
  const ports: DraftPrPorts = {
    draftOpen: async () => state.draft,
    hasPullRequestWorkflow: async () => { state.workflowReads++; return true; },
    openDraft: async () => {
      if (state.draft) return { ok: false, exists: true, reason: 'claim lost' };
      state.draft = true; state.opened++;
      return { ok: true, number: 7, url: 'https://x/pull/7' };
    },
    record: async () => undefined,
  };
  return { state, ports };
}

beforeEach(() => vi.clearAllMocks());

describe('the early draft PR across durable ticks', () => {
  it('tick 2 sees tick 1\'s draft: pending again, not none, and nothing is read or opened twice', async () => {
    const { state, ports } = durablePorts();
    const tick1 = cloudFinishPorts({ db, evt, repoCtx, delegated: false, noSandboxPr: { ports } });
    const first = await tick1.pollBranchCi!({ pendingBlocks: 0, failureBlocks: 0 });
    expect(first.block).toMatch(/still running/);

    // A new tick: fresh gate instance, same durable state.
    const tick2 = cloudFinishPorts({ db, evt, repoCtx, delegated: false, noSandboxPr: { ports } });
    const second = await tick2.pollBranchCi!({ pendingBlocks: 0, failureBlocks: 0 });
    expect(second.block).toMatch(/still running/);
    expect(state.opened).toBe(1);
    expect(state.workflowReads).toBe(1);
  });
});
