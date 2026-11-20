/**
 * PRD 48 §4.6 — a person's merge grant: who may give it, where, what it binds to, and when it is
 * voided. SQL-shaped assertions read the statement the function builds (the repo's PgDialect
 * pattern), so the scoping is what is tested, not a mock's echo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { shipDirective, shipPolicyOf } from '@builderforce/run-guards';

const h = vi.hoisted(() => ({
  onHost: vi.fn(async (..._a: unknown[]) => false),
  repos: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  head: vi.fn(async (..._a: unknown[]) => ({ ok: true, sha: 'abc123' }) as unknown),
  membership: vi.fn(async (..._a: unknown[]) => ({ isSuperadmin: false, role: 'developer' }) as unknown),
  reconcile: vi.fn(async (..._a: unknown[]) => ({ checked: false, providerState: null }) as unknown),
  report: vi.fn(),
}));
vi.mock('./runHostBinding', () => ({ wouldRunOnHost: h.onHost }));
vi.mock('../repos/taskRepoSet', () => ({ listTaskRepoBindings: h.repos }));
vi.mock('../security/prSecurityGate', () => ({ resolvePullRequestHead: h.head }));
vi.mock('../auth/tenantMembership', () => ({ resolveTenantMembership: h.membership }));
vi.mock('../repos/reconcilePullRequestState', () => ({ reconcilePullRequestState: h.reconcile }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report }));

import { TenantRole } from '../../domain/shared/types';
import { PR_MERGE_MIN_ROLE } from '../repos/prMergeAuthority';
import { runCommitMarker } from './agentCommitMarker';
import {
  bindGrantToThisRunsPr, claimMergeGrant, expireMergeGrants, grantedShipPolicy, granterStillAuthorized,
  mergeGrantDispatchRefusal, mergeGrantRefusal, reconcileStuckMergeClaims, recordedRunCommits,
  voidUnboundGrantOnTerminal, MERGE_GRANT_STUCK_CLAIM_MS,
} from './mergeGrants';

const dialect = new PgDialect();
const sqlOf = (s: SQL) => dialect.sqlToQuery(s).sql;

/**
 * A db double that answers `select` with `selectRows` and records every `update` (its `set` and its
 * WHERE as SQL) and `insert` (its values).
 */
function fakeDb(selectRows: unknown[] = [], updateReturns: unknown[] = [], selectQueue: unknown[][] = []) {
  const updates: Array<{ set: Record<string, unknown>; where: string }> = [];
  const inserts: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const pass = () => chain;
  chain.from = pass; chain.innerJoin = pass; chain.leftJoin = pass; chain.where = pass; chain.orderBy = pass;
  // Each select answers from `selectQueue` in order, then `selectRows` once the queue is empty.
  const queue = [...selectQueue];
  chain.limit = async () => (queue.length > 0 ? queue.shift() : selectRows);
  const db = {
    select: () => chain,
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (w: SQL) => {
          const rec = { set, where: sqlOf(w) };
          updates.push(rec);
          const done = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
          done.returning = async () => updateReturns;
          return done;
        },
      }),
    }),
    insert: () => ({ values: (v: unknown) => { inserts.push(v); return { onConflictDoUpdate: async () => undefined, onConflictDoNothing: async () => undefined }; } }),
  } as never;
  return { db, updates, inserts };
}

beforeEach(() => { vi.clearAllMocks(); h.onHost.mockResolvedValue(false); h.repos.mockResolvedValue([]); });

describe('mergeGrantRefusal — a PERSON, in the WEB APP, with the in-product merge role', () => {
  it('refuses a call made on an agent\'s behalf, and a machine caller', () => {
    expect(mergeGrantRefusal({ role: TenantRole.OWNER, agentActorRef: 'agent-1' })).toMatch(/only be given by a person/);
    expect(mergeGrantRefusal({ role: TenantRole.OWNER, machineActor: { agentHostId: 3 } })).toMatch(/only be given by a person/);
  });

  it('refuses an API-key call and a device client — the web app only', () => {
    expect(mergeGrantRefusal({ role: TenantRole.OWNER, apiKeyId: 'key-1' })).toMatch(/web app/);
    expect(mergeGrantRefusal({ role: TenantRole.OWNER, clientSurface: 'vscode' })).toMatch(/web app/);
  });

  it('refuses a person below the in-product merge role, accepts one at it', () => {
    expect(mergeGrantRefusal({ role: TenantRole.CONTRIBUTOR })).toMatch(/at least/);
    expect(PR_MERGE_MIN_ROLE).toBe(TenantRole.DEVELOPER);
    expect(mergeGrantRefusal({ role: TenantRole.DEVELOPER })).toBeNull();
  });
});

describe('mergeGrantDispatchRefusal — a single-repo CLOUD run only', () => {
  const task = { assignedAgentHostId: 5, assignedAgentRef: null };

  it('refuses a run the dispatcher would route to an on-prem host (run-now on a host-assigned ticket)', async () => {
    h.onHost.mockResolvedValue(true);
    const { db } = fakeDb([task]);
    expect(await mergeGrantDispatchRefusal({} as never, db, { tenantId: 7, taskId: 9 })).toMatchObject({ code: 'merge_grant_not_cloud' });
    // The dispatcher's own rule is asked with the ticket's host and agent.
    expect(h.onHost).toHaveBeenCalledWith({}, 7, { agentHostId: null, task, payload: undefined });
  });

  it('refuses a ticket spanning several repositories', async () => {
    h.repos.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const { db } = fakeDb([{ assignedAgentHostId: null, assignedAgentRef: 'agent-1' }]);
    expect(await mergeGrantDispatchRefusal({} as never, db, { tenantId: 7, taskId: 9 })).toMatchObject({ code: 'merge_grant_multi_repo' });
  });

  it('accepts a single-repo cloud run', async () => {
    h.repos.mockResolvedValue([{ id: 'a' }]);
    const { db } = fakeDb([{ assignedAgentHostId: null, assignedAgentRef: 'agent-1' }]);
    expect(await mergeGrantDispatchRefusal({} as never, db, { tenantId: 7, taskId: 9 })).toBeNull();
  });
});

describe('bindGrantToThisRunsPr — pinned to the LAST COMMIT THIS RUN PUSHED, proven by SHA', () => {
  const grant = { id: 'g-1', grantedBy: 'u', reason: 'r', createdAt: new Date(), consumedAt: null, voidedAt: null };
  // Every commit's subject carries the run marker: the marker is PUBLIC text, so it proves nothing.
  const commit = (sha: string) => ({ sha, message: `Update a.ts ${runCommitMarker(9, 42)}Coder)`, authorName: null });
  const args = { tenantId: 7, executionId: 42, taskId: 9, prRowId: 'pr-1' };
  /** The platform's record (`task_file_changes.commit_sha`): SHA → the execution that wrote it. */
  const recorded = (...rows: Array<[string, number]>) => rows.map(([sha, executionId]) => ({ sha, executionId }));
  /** select #1 = the grant, select #2 = the recorded run commits. */
  const dbWith = (rec: unknown[]) => fakeDb([], [], [[grant], rec]);

  it('binds the PR when its head is a SHA the provider returned for THIS run\'s write', async () => {
    const { db, inserts, updates } = dbWith(recorded(['abc123', 42]));
    expect(await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: 'ABC123', runCommits: [commit('abc123')] })).toBe(true);
    expect(inserts[0]).toMatchObject({ grantId: 'g-1', pullRequestId: 'pr-1', headSha: 'abc123' });
    expect(updates).toHaveLength(0);
  });

  it('FORGED MARKER: a head whose message carries this run\'s marker but whose SHA the platform never recorded voids head_moved', async () => {
    const { db, inserts, updates } = dbWith(recorded(['abc123', 42]));
    expect(await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: 'f0f0f0', runCommits: [commit('abc123'), commit('f0f0f0')] })).toBe(true);
    expect(inserts).toHaveLength(0);
    expect(updates[0]!.set).toMatchObject({ voidReason: 'head_moved' });
  });

  it('a head recorded for ANOTHER run of the ticket is not this run\'s — head_moved', async () => {
    const { db, inserts, updates } = dbWith(recorded(['abc123', 41]));
    await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: 'abc123', runCommits: [commit('abc123')] });
    expect(inserts).toHaveLength(0);
    expect(updates[0]!.set).toMatchObject({ voidReason: 'head_moved' });
  });

  it('RE-RUN binding: reads the PR head and binds when every commit ahead of base is a recorded run commit of this ticket', async () => {
    h.head.mockResolvedValue({ ok: true, sha: 'def456' });
    const { db, inserts } = dbWith(recorded(['aaa', 41], ['def456', 42]));
    expect(await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: null, runCommits: [commit('aaa'), commit('def456')] })).toBe(true);
    expect(inserts[0]).toMatchObject({ headSha: 'def456' });
  });

  it('RE-RUN with a FOREIGN commit ahead of base (a person\'s push, never recorded) voids foreign_commits', async () => {
    h.head.mockResolvedValue({ ok: true, sha: 'def456' });
    const { db, inserts, updates } = dbWith(recorded(['def456', 42]));
    const foreign = { sha: 'bbb', message: 'hotfix by hand', authorName: 'Bob' };
    expect(await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: null, runCommits: [foreign, commit('def456')] })).toBe(true);
    expect(inserts).toHaveLength(0);
    expect(updates[0]!.set).toMatchObject({ voidReason: 'foreign_commits' });
  });

  it('voids no_head when the run\'s own commits cannot be listed', async () => {
    const { db, updates } = dbWith(recorded(['abc123', 42]));
    expect(await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: 'abc123', runCommits: null })).toBe(true);
    expect(updates[0]!.set).toMatchObject({ voidReason: 'no_head' });
  });

  it('voids no_head when no head can be read', async () => {
    h.head.mockResolvedValue({ ok: false });
    const { db, updates } = dbWith(recorded(['abc123', 42]));
    await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: null, runCommits: [commit('abc123')] });
    expect(updates[0]!.set).toMatchObject({ voidReason: 'no_head' });
  });

  it('is a no-op for a run with no grant', async () => {
    const { db, updates, inserts } = fakeDb([]);
    expect(await bindGrantToThisRunsPr({} as never, db, { ...args, headSha: 'abc123', runCommits: [commit('abc123')] })).toBe(false);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('recordedRunCommits — the platform\'s own record, scoped to the tenant and ticket', () => {
  it('reads only rows with a recorded SHA, for this tenant\'s ticket, lower-cased', async () => {
    const wheres: string[] = [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = (w: SQL) => { wheres.push(sqlOf(w)); return chain; };
    chain.limit = async () => [{ sha: 'ABC', executionId: 42 }];
    const db = { select: () => chain } as never;
    const out = await recordedRunCommits(db, 7, 9);
    expect(out.get('abc')).toBe(42);
    expect(wheres[0]).toContain('"task_file_changes"."tenant_id" = $');
    expect(wheres[0]).toContain('"task_file_changes"."task_id" = $');
    expect(wheres[0]).toContain('"task_file_changes"."commit_sha" is not null');
  });
});

describe('reconcileStuckMergeClaims — a claim kept over a thrown merge never sits pending forever', () => {
  const stuckRow = { grantId: 'g-1', tenantId: 7, consumedAt: new Date('2026-11-19T00:00:00Z'), id: 'pr-1', number: 5, repoId: 'r-1', status: 'open', updatedAt: new Date() };

  it('selects only claimed, unvoided grants over an OPEN PR whose claim is older than 30 minutes', async () => {
    const wheres: string[] = [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain; chain.innerJoin = () => chain;
    chain.where = (w: SQL) => { wheres.push(sqlOf(w)); return chain; };
    chain.limit = async () => [];
    await reconcileStuckMergeClaims({} as never, { select: () => chain } as never, new Date('2026-11-20T00:00:00Z'));
    expect(wheres[0]).toContain('"merge_grants"."consumed_at" is not null');
    expect(wheres[0]).toContain('"merge_grants"."voided_at" is null');
    expect(wheres[0]).toContain('"pull_requests"."status" = $');
    expect(wheres[0]).toContain('"merge_grants"."consumed_at" < $');
    expect(MERGE_GRANT_STUCK_CLAIM_MS).toBe(30 * 60 * 1000);
  });

  it('the provider says MERGED → the grant stays spent (no release)', async () => {
    h.reconcile.mockResolvedValueOnce({ checked: true, providerState: 'merged' });
    const { db, updates } = fakeDb([stuckRow]);
    expect(await reconcileStuckMergeClaims({} as never, db)).toBe(1);
    expect(h.reconcile).toHaveBeenCalledWith(expect.anything(), db, 7, stuckRow, { forceFresh: true });
    expect(updates).toHaveLength(0);
  });

  it('the provider says NOT merged → the claim is released back to live, tenant-scoped, and reported', async () => {
    h.reconcile.mockResolvedValueOnce({ checked: true, providerState: 'open' });
    const { db, updates } = fakeDb([stuckRow]);
    expect(await reconcileStuckMergeClaims({} as never, db)).toBe(1);
    expect(updates[0]!.set).toEqual({ consumedAt: null });
    expect(updates[0]!.where).toContain('"merge_grants"."tenant_id" = $');
    expect(h.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'reconcileStuckMergeClaims' }));
  });

  it('an unreachable provider leaves the claim for the next tick', async () => {
    h.reconcile.mockResolvedValueOnce({ checked: false, providerState: null });
    const { db, updates } = fakeDb([stuckRow]);
    expect(await reconcileStuckMergeClaims({} as never, db)).toBe(0);
    expect(updates).toHaveLength(0);
  });
});

describe('voidUnboundGrantOnTerminal — the terminal hook', () => {
  it('a FAILED run voids its unbound grant (run_failed), scoped to the tenant and execution', async () => {
    const { db, updates } = fakeDb();
    await voidUnboundGrantOnTerminal(db, { id: 42, tenantId: 7, status: 'failed' });
    expect(updates[0]!.set).toMatchObject({ voidReason: 'run_failed' });
    expect(updates[0]!.where).toContain('"merge_grants"."tenant_id" = $');
    expect(updates[0]!.where).toContain('"merge_grants"."execution_id" = $');
    // A grant already bound to a PR is left alone: its merge stands on its own evidence.
    expect(updates[0]!.where).toContain('not exists (select 1 from "merge_grant_pull_requests"');
  });

  it('a CANCELLED run voids it as cancelled; a COMPLETED run is finalize\'s to settle', async () => {
    const cancelled = fakeDb();
    await voidUnboundGrantOnTerminal(cancelled.db, { id: 42, tenantId: 7, status: 'cancelled' });
    expect(cancelled.updates[0]!.set).toMatchObject({ voidReason: 'cancelled' });
    const completed = fakeDb();
    await voidUnboundGrantOnTerminal(completed.db, { id: 42, tenantId: 7, status: 'completed' });
    expect(completed.updates).toHaveLength(0);
  });
});

describe('expiry and the granter\'s CURRENT authority', () => {
  it('expires live grants older than seven days, each by a tenant-scoped void', async () => {
    const { db, updates } = fakeDb([{ grantId: 'g-1', tenantId: 4 }, { grantId: 'g-2', tenantId: 9 }]);
    const selectWheres: string[] = [];
    const base = db as unknown as { select: () => Record<string, unknown> };
    const select = base.select;
    base.select = () => {
      const chain = select();
      return { ...chain, from: () => ({ ...chain, where: (w: SQL) => { selectWheres.push(sqlOf(w)); return chain; } }) };
    };
    const now = new Date('2026-11-20T00:00:00Z');
    expect(await expireMergeGrants(db, now)).toBe(2);
    // The stale cohort: live (neither consumed nor voided) and created before now − 7 days.
    expect(selectWheres[0]).toContain('"merge_grants"."created_at" < $');
    expect(selectWheres[0]).toContain('"merge_grants"."consumed_at" is null');
    expect(selectWheres[0]).toContain('"merge_grants"."voided_at" is null');
    // Each one voided `expired` under ITS OWN tenant, still only if live.
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(u.set).toMatchObject({ voidReason: 'expired' });
      expect(u.where).toContain('"merge_grants"."tenant_id" = $');
      expect(u.where).toContain('"merge_grants"."voided_at" is null');
    }
  });

  it('a granter who left the workspace, lost the role, or was deleted no longer authorizes the merge', async () => {
    h.membership.mockResolvedValueOnce(null);
    expect(await granterStillAuthorized({} as never, {} as never, 7, 'u-1')).toBe(false);
    h.membership.mockResolvedValueOnce({ isSuperadmin: false, role: 'contributor' });
    expect(await granterStillAuthorized({} as never, {} as never, 7, 'u-1')).toBe(false);
    expect(await granterStillAuthorized({} as never, {} as never, 7, null)).toBe(false);
    h.membership.mockResolvedValueOnce({ isSuperadmin: false, role: 'developer' });
    expect(await granterStillAuthorized({} as never, {} as never, 7, 'u-1')).toBe(true);
  });
});

describe('claimMergeGrant — ONE merge per grant, atomically', () => {
  it('claims only a grant that is neither consumed nor voided, in the UPDATE itself', async () => {
    const { db, updates } = fakeDb([], [{ id: 'g-1' }]);
    expect(await claimMergeGrant(db, 4, 'g-1')).toBe(true);
    expect(updates[0]!.where).toContain('"merge_grants"."consumed_at" is null');
    expect(updates[0]!.where).toContain('"merge_grants"."voided_at" is null');
    expect(updates[0]!.where).toContain('"merge_grants"."tenant_id" = $');
  });

  it('a grant someone else already claimed is not claimed again', async () => {
    const { db } = fakeDb([], []);
    expect(await claimMergeGrant(db, 4, 'g-1')).toBe(false);
  });
});

describe('the run knows — grantedShipPolicy', () => {
  const base = { ...shipPolicyOf('pull_request', 'project_settings'), merge: 'never' as const };

  it('a granted run merges on green by a person\'s authority', () => {
    expect(grantedShipPolicy(base)).toMatchObject({ mode: 'pull_request', merge: 'on_green', source: 'person_grant' });
  });

  it('its cloud directive says a person authorized the merge, the platform merges on green, and the run must not merge or push', () => {
    const d = shipDirective(grantedShipPolicy(base), { host: 'cloud' });
    expect(d).toContain('A person authorized merging this pull request into main');
    expect(d).toContain('Never merge or push the base branch yourself');
    expect(d).not.toContain('open_pull_request');
  });
});
