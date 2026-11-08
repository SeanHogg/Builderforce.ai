/**
 * The API half of the `governance_audit` tool. What has to hold: a project of another tenant is
 * never resolved, audited or written against; every read and write carries (tenant, segment); the
 * ruleset hash is stable for the same configuration; finalize closes the run and writes its
 * findings in ONE transaction, a retry answers 409 without writing findings twice, another
 * tenant's rule id is dropped (rule_ref kept), and a large run is inserted in bounded chunks.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { fakeDb, whereColumns, type FakeDb } from '../../../test/fakeDb';
import {
  finalizeGovernanceAudit, GOVERNANCE_FINDINGS_INSERT_CHUNK, resolveGovernanceRuleset, startGovernanceAudit,
  type GovernanceFindingInput,
} from './governanceRuleAudits';

const scope = { tenantId: 7, segmentId: '22222222-2222-4222-8222-222222222222' };
const RUN = '11111111-1111-4111-8111-111111111111';
const OWN_RULE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_RULE = '44444444-4444-4444-8444-444444444444';
const asDb = (db: FakeDb) => db as unknown as Db;

const finding = (over: Partial<GovernanceFindingInput> = {}): GovernanceFindingInput => ({
  ruleRef: 'SEC.SECRET.NO_HARDCODED', severity: 'blocker', title: 'Hard-coded secret',
  detail: 'matched src/a.ts:3', source: 'prefilter', confidence: 'high', ...over,
});
const finalizeInput = (findings: GovernanceFindingInput[]) => ({
  findings, summary: { blocker: findings.length, passed: 0 }, gateResult: 'blocked' as const, rulesetHash: 'h'.repeat(64),
});

const pack = { id: 'p1', name: 'Org baseline' };
const rule = {
  id: OWN_RULE, packId: 'p1', ruleRef: 'SEC.SECRET.NO_HARDCODED', category: 'secrets', title: 'No secrets',
  description: 'No hard-coded secrets', severity: 'blocker', check: { kind: 'secret' }, guidance: null,
};

describe('resolveGovernanceRuleset', () => {
  it('404s a project of another tenant without reading any pack', async () => {
    const db = fakeDb([[]]); // projectInTenant → no row
    const out = await resolveGovernanceRuleset(asDb(db), scope, 99);
    expect(out).toEqual({ ok: false, status: 404, error: 'project not found' });
    expect(db.calls).toHaveLength(1);
    expect(whereColumns(db.calls[0]!.where)).toEqual(expect.arrayContaining(['tenant_id', 'id']));
  });

  it('reads packs tenant+segment scoped and skips the rules query when none apply', async () => {
    const db = fakeDb([[]]);
    const out = await resolveGovernanceRuleset(asDb(db), scope, null);
    expect(out.ok && out.value.rules).toEqual([]);
    expect(out.ok && out.value.packsApplied).toEqual([]);
    expect(out.ok && out.value.rulesetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.calls).toHaveLength(1);
    expect(whereColumns(db.calls[0]!.where)).toEqual(expect.arrayContaining(['tenant_id', 'segment_id', 'status', 'project_id']));
  });

  it('answers the enabled rules of the in-scope packs, tenant-scoped, with a stable hash', async () => {
    const first = fakeDb([[{ id: 5 }], [pack], [rule]]);
    const a = await resolveGovernanceRuleset(asDb(first), scope, 5);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.packsApplied).toEqual([{ packId: 'p1', name: 'Org baseline', source: 'db' }]);
    expect(a.value.rules).toEqual([{ ...rule, enabled: true }]);
    expect(whereColumns(first.calls[2]!.where)).toEqual(expect.arrayContaining(['tenant_id', 'pack_id', 'enabled']));

    const again = await resolveGovernanceRuleset(asDb(fakeDb([[{ id: 5 }], [pack], [rule]])), scope, 5);
    expect(again.ok && again.value.rulesetHash).toBe(a.value.rulesetHash);
    const changed = await resolveGovernanceRuleset(
      asDb(fakeDb([[{ id: 5 }], [pack], [{ ...rule, severity: 'high' }]])), scope, 5,
    );
    expect(changed.ok && changed.value.rulesetHash).not.toBe(a.value.rulesetHash);
  });
});

describe('startGovernanceAudit', () => {
  const input = { projectId: 9, repoRef: 'org/repo', ref: 'main', trigger: 'manual' as const, agentRunId: null };

  it('404s a project of another tenant and opens no run', async () => {
    const db = fakeDb([[]]);
    expect(await startGovernanceAudit(asDb(db), scope, input)).toEqual({ ok: false, status: 404, error: 'project not found' });
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('opens a running run stamped with the request scope', async () => {
    const db = fakeDb([[{ id: 9 }], [{ id: RUN }]]);
    expect(await startGovernanceAudit(asDb(db), scope, input)).toEqual({ ok: true, value: { runId: RUN } });
    const insert = db.calls.find((c) => c.kind === 'insert')!;
    expect(insert.payload).toMatchObject({
      tenantId: 7, segmentId: scope.segmentId, projectId: 9, status: 'running', trigger: 'manual', repoRef: 'org/repo',
    });
  });

  it('a tenant-wide run (no project) skips the ownership read', async () => {
    const db = fakeDb([[{ id: RUN }]]);
    expect(await startGovernanceAudit(asDb(db), scope, { ...input, projectId: null })).toEqual({ ok: true, value: { runId: RUN } });
    expect(db.calls.map((c) => c.kind)).toEqual(['insert']);
  });
});

describe('finalizeGovernanceAudit', () => {
  it('closes the run and writes its findings inside one transaction, all scoped', async () => {
    const db = fakeDb([[{ id: RUN }], [{ id: OWN_RULE }], []]);
    const tx = vi.spyOn(db, 'transaction');
    const out = await finalizeGovernanceAudit(asDb(db), scope, RUN, {
      ...finalizeInput([finding({ ruleId: OWN_RULE })]),
      packsApplied: [{ packId: 'p1', name: 'Org baseline', source: 'db' }],
    });
    expect(out).toEqual({ ok: true, value: { runId: RUN, findings: 1 } });
    expect(tx).toHaveBeenCalledTimes(1);

    const [close, ruleRead, insert] = db.calls;
    expect(close!.kind).toBe('update');
    expect(close!.payload).toMatchObject({
      status: 'completed', gateResult: 'blocked', rulesetHash: 'h'.repeat(64),
      packsApplied: [{ packId: 'p1', name: 'Org baseline', source: 'db' }],
    });
    expect(whereColumns(close!.where)).toEqual(expect.arrayContaining(['id', 'tenant_id', 'segment_id', 'status']));
    expect(whereColumns(ruleRead!.where)).toEqual(expect.arrayContaining(['tenant_id', 'segment_id', 'id']));
    expect(insert!.payload).toEqual([expect.objectContaining({
      tenantId: 7, segmentId: scope.segmentId, runId: RUN, ruleId: OWN_RULE, ruleRef: 'SEC.SECRET.NO_HARDCODED',
    })]);
  });

  it("drops a rule id that is not this tenant's but keeps the finding by rule_ref", async () => {
    const db = fakeDb([[{ id: RUN }], [{ id: OWN_RULE }], []]);
    await finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput([
      finding({ ruleId: OWN_RULE }), finding({ ruleId: FOREIGN_RULE, ruleRef: 'OTHER.RULE' }),
    ]));
    const insert = db.calls.find((c) => c.kind === 'insert')!;
    expect((insert.payload as Array<{ ruleId: string | null; ruleRef: string }>).map((r) => [r.ruleId, r.ruleRef])).toEqual([
      [OWN_RULE, 'SEC.SECRET.NO_HARDCODED'], [null, 'OTHER.RULE'],
    ]);
  });

  it('skips the rule-ownership read when no finding names a rule, and writes nothing for zero findings', async () => {
    const db = fakeDb([[{ id: RUN }]]);
    expect(await finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput([]))).toEqual({ ok: true, value: { runId: RUN, findings: 0 } });
    expect(db.calls.map((c) => c.kind)).toEqual(['update']);
  });

  it('404s a run that is not in this scope (another tenant’s run included)', async () => {
    const db = fakeDb([[], []]);
    expect(await finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput([finding()])))
      .toEqual({ ok: false, status: 404, error: 'audit run not found' });
    expect(whereColumns(db.calls[1]!.where)).toEqual(expect.arrayContaining(['id', 'tenant_id', 'segment_id']));
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('regression: a retried finalize answers 409 and never writes the findings twice', async () => {
    // ONE database across both POSTs: the first closes the run (update → row) and inserts; the
    // retry's compare-and-set matches nothing (update → []) and the run still exists (select → row).
    const db = fakeDb([[{ id: RUN }], [], [], [{ id: RUN }]]);
    const findings = [finding(), finding({ ruleRef: 'B' })];
    expect(await finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput(findings)))
      .toEqual({ ok: true, value: { runId: RUN, findings: 2 } });
    expect(await finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput(findings)))
      .toEqual({ ok: false, status: 409, error: 'audit run is already finalized' });
    expect(db.calls.map((c) => c.kind)).toEqual(['update', 'insert', 'update', 'select']);
    expect(db.calls.filter((c) => c.kind === 'insert')).toHaveLength(1);
    expect(db.remaining()).toBe(0);
  });

  it('inserts a large run in chunks that stay under the Postgres bind-parameter cap', async () => {
    const n = GOVERNANCE_FINDINGS_INSERT_CHUNK * 2 + 500;
    const db = fakeDb([[{ id: RUN }]]);
    const out = await finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput(Array.from({ length: n }, (_, i) => finding({ line: i }))));
    expect(out).toEqual({ ok: true, value: { runId: RUN, findings: n } });
    const inserts = db.calls.filter((c) => c.kind === 'insert').map((c) => (c.payload as unknown[]).length);
    expect(inserts).toEqual([GOVERNANCE_FINDINGS_INSERT_CHUNK, GOVERNANCE_FINDINGS_INSERT_CHUNK, 500]);
    expect(GOVERNANCE_FINDINGS_INSERT_CHUNK * 14).toBeLessThan(65_535);
  });

  it('a failed findings insert rejects out of the transaction (the close is rolled back with it)', async () => {
    const db = fakeDb([[{ id: RUN }], new Error('insert failed')]);
    await expect(finalizeGovernanceAudit(asDb(db), scope, RUN, finalizeInput([finding()]))).rejects.toThrow('insert failed');
  });
});
