/**
 * PRD 48 §4.6 — the PR merge sweep's GRANTED cohort. A person's merge grant is a pre-approved
 * human merge: it merges ONLY the PR the granted run opened, ONLY at the head that run left, ONCE,
 * and only after the in-product Merge button's own checks (`gateHumanMerge`) plus green CI.
 *
 * Two layers: the cohort QUERY (its joins and filters, read off the SQL it builds — the repo's
 * PgDialect pattern), and the cohort LOOP over the rows that query returns.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  live: vi.fn(async (..._a: unknown[]) => false),
  gate: vi.fn(async (..._a: unknown[]) => ({ ok: true, headSha: 'abc123' }) as unknown),
  ci: vi.fn(async (..._a: unknown[]) => ({ headSha: 'abc123', green: true }) as unknown),
  merge: vi.fn(async (..._a: unknown[]) => ({ ok: true, merged: true, sha: 'm1', pullRequest: null }) as unknown),
  claim: vi.fn(async (..._a: unknown[]) => true),
  release: vi.fn(async (..._a: unknown[]) => undefined),
  void: vi.fn(async (..._a: unknown[]) => undefined),
  setHold: vi.fn(async (..._a: unknown[]) => undefined),
  journal: vi.fn(async (..._a: unknown[]) => undefined),
  journalOnChange: vi.fn(async (..._a: unknown[]) => true),
  policy: vi.fn(),
}));

vi.mock('../runtime/liveExecutionStatus', () => ({ taskHasLiveRun: h.live }));
vi.mock('./humanMergeGate', () => ({ gateHumanMerge: h.gate }));
vi.mock('./pollPrCiStatus', () => ({ pollPrCiHead: h.ci }));
vi.mock('./mergeRecordedPr', () => ({ mergeRecordedPullRequest: h.merge }));
vi.mock('../runtime/mergeGrants', () => ({
  claimMergeGrant: h.claim, releaseMergeGrant: h.release, voidMergeGrant: h.void, setMergeGrantHold: h.setHold,
  MERGE_GRANT_HELD_ACTION: 'merge_grant_held',
}));
vi.mock('../manager/managerActionJournal', () => ({
  recordManagerAction: h.journal, recordManagerActionOnChange: h.journalOnChange, stateFingerprint: (p: unknown[]) => JSON.stringify(p),
}));
// The cohort must never consult the project's manager policy: a grant overrides it.
vi.mock('../manager/managerPolicyStore', () => ({ getEffectiveManagerPolicy: h.policy, getProjectManagerState: h.policy }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { loadGrantedPrs, runGrantedMerges, MAX_GRANTED_MERGES_PER_TICK, type GrantedPr } from './grantedMergeCohort';

const dialect = new PgDialect();
const sqlOf = (s: SQL) => dialect.sqlToQuery(s).sql;

/** A db double that records the joins and filter the cohort query builds, and answers `rows`. */
function recordingDb(rows: GrantedPr[]) {
  const seen: { joins: string[]; where?: string } = { joins: [] };
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: (_t: unknown, on: SQL) => { seen.joins.push(sqlOf(on)); return chain; },
    where: (w: SQL) => { seen.where = sqlOf(w); return chain; },
    orderBy: () => chain,
    limit: async () => rows,
  };
  return { db: { select: () => chain } as never, seen };
}

const bound = (o: Partial<GrantedPr> = {}): GrantedPr => ({
  bindingId: 'b-1', grantId: 'g-1', grantedBy: 'user-1', pinnedHeadSha: 'abc123',
  tenantId: 4, projectId: 9, taskId: 77, id: 'pr-1', number: 12, repoId: 'r-1', buildStatus: 'success', updatedAt: new Date(),
  ...o,
});
const budget = { over: () => false, canAfford: () => true } as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.live.mockResolvedValue(false);
  h.gate.mockResolvedValue({ ok: true, headSha: 'abc123' });
  h.ci.mockResolvedValue({ headSha: 'abc123', green: true });
  h.merge.mockResolvedValue({ ok: true, merged: true, sha: 'm1', pullRequest: null });
  h.claim.mockResolvedValue(true);
});

describe('the cohort QUERY binds a grant to the PR its run opened — never the ticket', () => {
  it('joins through merge_grant_pull_requests to the PR by id, tenant-correlated at every join', async () => {
    const { db, seen } = recordingDb([]);
    await loadGrantedPrs(db);
    expect(seen.joins).toHaveLength(2);
    const [grantJoin, prJoin] = seen.joins;
    expect(grantJoin).toContain('"merge_grants"."id" = "merge_grant_pull_requests"."grant_id"');
    expect(grantJoin).toContain('"merge_grants"."tenant_id" = "merge_grant_pull_requests"."tenant_id"');
    expect(prJoin).toContain('"pull_requests"."id" = "merge_grant_pull_requests"."pull_request_id"');
    expect(prJoin).toContain('"pull_requests"."tenant_id" = "merge_grant_pull_requests"."tenant_id"');
    // An ungranted re-run's PR on the same ticket cannot be reached: nothing joins on the ticket.
    expect(seen.joins.join(' ')).not.toContain('task_id');
  });

  it('only LIVE grants (neither consumed nor voided) on OPEN pull requests', async () => {
    const { db, seen } = recordingDb([]);
    await loadGrantedPrs(db);
    expect(seen.where).toContain('"merge_grants"."consumed_at" is null');
    expect(seen.where).toContain('"merge_grants"."voided_at" is null');
    expect(seen.where).toContain('"pull_requests"."status" = $');
  });
});

describe('runGrantedMerges — the loop over bound PRs', () => {
  it('regression: PRD 48 §4.6 — a person\'s merge grant lands a hotfix on an unmanaged project', async () => {
    const { db } = recordingDb([bound()]);
    const out = await runGrantedMerges({} as never, db, budget);
    // The project's manager policy (opt-in, allowAutoMerge, canary) is never read.
    expect(h.policy).not.toHaveBeenCalled();
    expect(h.claim).toHaveBeenCalledWith(db, 4, 'g-1');
    expect(h.merge).toHaveBeenCalledWith(db, {}, expect.objectContaining({
      tenantId: 4, prId: 'pr-1', method: 'squash', mergedBy: 'user-1', expectedHeadSha: 'abc123',
    }));
    expect(h.claim.mock.invocationCallOrder[0]).toBeLessThan(h.merge.mock.invocationCallOrder[0]!);
    expect(h.setHold).toHaveBeenCalledWith(db, 4, 'b-1', null);
    expect(out).toEqual({ considered: 1, merged: 1, held: 0, voided: 0 });
  });

  it('applies the in-product Merge button\'s own check (gateHumanMerge), inline when the budget affords it', async () => {
    const { db } = recordingDb([bound()]);
    await runGrantedMerges({} as never, db, budget);
    expect(h.gate).toHaveBeenCalledWith(db, {}, 4, 'pr-1', { mode: 'inline' });
  });

  it('two PRs bound to ONE grant: at most one merges', async () => {
    const { db } = recordingDb([bound(), bound({ id: 'pr-2', bindingId: 'b-2', number: 13 })]);
    const out = await runGrantedMerges({} as never, db, budget);
    expect(h.merge).toHaveBeenCalledTimes(1);
    expect(out.merged).toBe(1);
  });

  it('a grant another sweep already claimed is not merged again', async () => {
    h.claim.mockResolvedValue(false);
    const { db } = recordingDb([bound()]);
    await runGrantedMerges({} as never, db, budget);
    expect(h.merge).not.toHaveBeenCalled();
  });

  it('a head pushed past the pinned commit VOIDS the grant — nothing merges', async () => {
    h.gate.mockResolvedValue({ ok: true, headSha: 'def456' });
    const { db } = recordingDb([bound()]);
    const out = await runGrantedMerges({} as never, db, budget);
    expect(h.void).toHaveBeenCalledWith(db, { tenantId: 4, grantId: 'g-1', reason: 'head_moved' });
    expect(h.merge).not.toHaveBeenCalled();
    expect(out.voided).toBe(1);
  });

  it('holds on a FAILED security verdict with its current code, and journals why', async () => {
    h.gate.mockResolvedValue({ ok: false, status: 409, body: { error: 'held for security: blocker', code: 'security_gate', details: { reasons: [{ code: 'open_blocker' }], headSha: 'abc123' } } });
    const { db } = recordingDb([bound()]);
    const out = await runGrantedMerges({} as never, db, budget);
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.setHold).toHaveBeenCalledWith(db, 4, 'b-1', 'security');
    expect(h.journalOnChange).toHaveBeenCalledWith(db, expect.objectContaining({ actionType: 'merge_grant_held', stateKey: 'merge-grant:pr-1' }));
    expect(out.held).toBe(1);
  });

  it('holds on RED CI', async () => {
    h.ci.mockResolvedValue({ headSha: 'abc123', green: false });
    const { db } = recordingDb([bound({ buildStatus: 'failure' })]);
    await runGrantedMerges({} as never, db, budget);
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.setHold).toHaveBeenCalledWith(db, 4, 'b-1', 'ci_failed');
  });

  it.each([
    ['unknown (no CI read)', null],
    ['pending', { headSha: 'abc123', green: false }],
    ['green on a different commit', { headSha: 'zzz999', green: true }],
  ])('holds when CI is %s', async (_label, ci) => {
    h.ci.mockResolvedValue(ci);
    const { db } = recordingDb([bound({ buildStatus: null })]);
    await runGrantedMerges({} as never, db, budget);
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.setHold).toHaveBeenCalledWith(db, 4, 'b-1', 'ci_pending');
  });

  it('gives the grant back when the provider refuses the merge', async () => {
    h.merge.mockResolvedValue({ ok: false, httpStatus: 405, error: 'branch protection', code: 'provider_error' });
    const { db } = recordingDb([bound()]);
    await runGrantedMerges({} as never, db, budget);
    expect(h.release).toHaveBeenCalledWith(db, 4, 'g-1');
    expect(h.setHold).toHaveBeenCalledWith(db, 4, 'b-1', 'merge_refused');
  });

  it('waits while a run is still writing the branch', async () => {
    h.live.mockResolvedValue(true);
    const { db } = recordingDb([bound()]);
    const out = await runGrantedMerges({} as never, db, budget);
    expect(h.gate).not.toHaveBeenCalled();
    expect(out.considered).toBe(0);
  });

  it('caps the merges per tick and stops when the sweep budget is spent', async () => {
    const many = Array.from({ length: MAX_GRANTED_MERGES_PER_TICK + 2 }, (_, i) => bound({ grantId: `g-${i}`, bindingId: `b-${i}`, id: `pr-${i}` }));
    await runGrantedMerges({} as never, recordingDb(many).db, budget);
    expect(h.merge).toHaveBeenCalledTimes(MAX_GRANTED_MERGES_PER_TICK);
    vi.clearAllMocks();
    await runGrantedMerges({} as never, recordingDb(many).db, { over: () => true, canAfford: () => false } as never);
    expect(h.merge).not.toHaveBeenCalled();
  });
});
