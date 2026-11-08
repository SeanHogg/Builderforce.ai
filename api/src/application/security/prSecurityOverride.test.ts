import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  head: vi.fn(), evidence: vi.fn(async () => 1), audit: vi.fn(async () => undefined), inserts: [] as Array<Record<string, unknown>>,
}));
vi.mock('./prSecurityGate', () => ({ resolvePullRequestHead: h.head }));
vi.mock('./ensurePrSecurityVerdict', () => ({ securityVerdictEnsuringScan: vi.fn() }));
vi.mock('../governance/automatedSocEvidence', () => ({ recordAutomatedEvidence: h.evidence }));
vi.mock('../governance/mutationAudit', () => ({ recordGovernanceMutation: h.audit }));

import { PgDialect } from 'drizzle-orm/pg-core';
import { acceptPrSecurityRisk, describePrGate, listOpenPullRequests } from './prSecurityOverride';

const CURRENT = 'd'.repeat(40);
const OLD = 'e'.repeat(40);
const scope = { tenantId: 1, segmentId: 'seg' };
const actor = { type: 'human' as const, ref: 'u1', name: 'Ada' };
const reason = 'Reviewed manually; the scanner cannot read this monorepo.';

function fakeDb(pr: Record<string, unknown> | null) {
  let selects = 0;
  return {
    // 1st select = the PR row; any later one = the tenant's default segment lookup
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (selects++ === 0 ? (pr ? [pr] : []) : [{ id: 'default-seg' }]) }) }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => ({ onConflictDoNothing: () => ({ returning: async () => { h.inserts.push(v); return [{ id: 'ov1' }]; } }) }) }),
  } as never;
}

beforeEach(() => { h.inserts.length = 0; h.head.mockReset(); h.evidence.mockClear(); h.audit.mockClear(); });

describe('accept-risk is bound to the commit the manager SAW', () => {
  it('409s and records NOTHING when the head has moved since (the SHA does not match)', async () => {
    h.head.mockResolvedValue({ ok: true, sha: CURRENT });
    const out = await acceptPrSecurityRisk({} as never, fakeDb({ id: 'pr', number: 3, url: null, status: 'open', segmentId: 'seg' }), scope, {
      pullRequestId: 'pr', reason, actor, tenantAdmin: false, expectedHeadSha: OLD,
    });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(h.inserts).toHaveLength(0);
    expect(h.evidence).not.toHaveBeenCalled();
  });

  it('records the override for exactly the commit that was shown', async () => {
    h.head.mockResolvedValue({ ok: true, sha: CURRENT });
    const out = await acceptPrSecurityRisk({} as never, fakeDb({ id: 'pr', number: 3, url: null, status: 'open', segmentId: 'seg' }), scope, {
      pullRequestId: 'pr', reason, actor, tenantAdmin: false, expectedHeadSha: CURRENT.toUpperCase(),
    });
    expect(out).toMatchObject({ ok: true, headSha: CURRENT, alreadyAccepted: false });
    expect(h.inserts[0]).toMatchObject({ pullRequestId: 'pr', headSha: CURRENT, segmentId: 'seg' });
    expect(h.evidence).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ kind: 'override' }));
  });

  it('a segment-less PR can be overridden ONLY by a tenant admin - a segment manager gets 403 and nothing is recorded', async () => {
    h.head.mockResolvedValue({ ok: true, sha: CURRENT });
    const out = await acceptPrSecurityRisk({} as never, fakeDb({ id: 'pr', number: 3, url: null, status: 'open', segmentId: null }), scope, {
      pullRequestId: 'pr', reason, actor, tenantAdmin: false, expectedHeadSha: CURRENT,
    });
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(h.inserts).toHaveLength(0);
    expect(h.evidence).not.toHaveBeenCalled();
  });

  it('a tenant admin\'s override is ONE consistent tenant-scope record: segment NULL on the row and the audit, evidence under the default segment', async () => {
    h.head.mockResolvedValue({ ok: true, sha: CURRENT });
    const out = await acceptPrSecurityRisk({} as never, fakeDb({ id: 'pr', number: 3, url: null, status: 'open', segmentId: null }), scope, {
      pullRequestId: 'pr', reason, actor, tenantAdmin: true, expectedHeadSha: CURRENT,
    });
    expect(out.ok).toBe(true);
    expect(h.inserts[0]).toMatchObject({ segmentId: null });
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ segmentId: null, note: { scope: 'tenant' } }));
    expect(h.evidence).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      segmentId: 'default-seg', note: expect.stringContaining('scope: tenant'),
    }));
  });

  it('refuses a short reason and an already-merged PR', async () => {
    expect(await acceptPrSecurityRisk({} as never, fakeDb(null), scope, { pullRequestId: 'pr', reason: 'ok', actor, tenantAdmin: false, expectedHeadSha: CURRENT }))
      .toMatchObject({ ok: false, status: 400 });
    h.head.mockResolvedValue({ ok: true, sha: CURRENT });
    expect(await acceptPrSecurityRisk({} as never, fakeDb({ id: 'pr', number: 3, url: null, status: 'merged', segmentId: 'seg' }), scope, { pullRequestId: 'pr', reason, actor, tenantAdmin: false, expectedHeadSha: CURRENT }))
      .toMatchObject({ ok: false, status: 409 });
  });
});

describe('segment-less pull requests are for tenant admins only', () => {
  /** Captures the WHERE of the open-PR list and renders it, so the segment predicate can be read. */
  function listing() {
    const wheres: unknown[] = [];
    const db = { select: () => ({ from: () => ({ where: (w: unknown) => { wheres.push(w); return { orderBy: () => ({ limit: async () => [] }) }; } }) }) } as never;
    return { db, sqlOf: () => new PgDialect().sqlToQuery(wheres[0] as never).sql };
  }

  it('the picker lists NULL-segment PRs for a tenant admin and never for anyone else', async () => {
    const admin = listing();
    await listOpenPullRequests(admin.db, scope, true);
    expect(admin.sqlOf()).toMatch(/segment_id" is null/i);
    const manager = listing();
    await listOpenPullRequests(manager.db, scope, false);
    expect(manager.sqlOf()).not.toMatch(/is null/i);
  });

  it('the gate view of a segment-less PR does not exist for a segment manager', async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'pr', segmentId: null }] }) }) }) } as never;
    expect(await describePrGate(db, {} as never, scope, 'pr', false)).toBeNull();
  });
});
