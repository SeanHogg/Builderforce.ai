/**
 * The verifier (PRD 33 §5.1.5): each action's measure — the ticket effect for Fix
 * it / Ticket, `variantResults` for Test it (no verdict while underpowered; a
 * decided test is concluded), enrolled-vs-not for Follow up — writes `measured`
 * and the verdict, offers Revert on `worse` after a publish, settles the issue
 * group, and records `prescription.verify` in the outcome ledger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effectFor: vi.fn(),
  variantResults: vi.fn(),
  stopTest: vi.fn(async () => ({})),
  measureFollowUp: vi.fn(),
  recordOutcomeEvent: vi.fn(async () => true),
}));
vi.mock('./ticketEffect', () => ({ effectFor: mocks.effectFor }));
vi.mock('../marketing/experimentation', () => ({ variantResults: mocks.variantResults, stopTest: mocks.stopTest }));
vi.mock('./prescriptionFollowUp', () => ({ measureFollowUp: mocks.measureFollowUp }));
vi.mock('../outcomes/outcomeLedger', () => ({ recordOutcomeEvent: mocks.recordOutcomeEvent }));
vi.mock('../activity/activityLog', () => ({ SYSTEM_ACTOR: { type: 'system', ref: null, name: 'System' } }));
vi.mock('./replaySites', () => ({ getSite: vi.fn() }));

import { replayIssues, replayPrescriptions } from '../../infrastructure/database/schema';
import { toPrescriptionDto, type PrescriptionRow } from './prescriptionReads';
import { verifyPrescription, VERIFIERS } from './prescriptionVerify';

const SITE_ID = '11111111-2222-4333-8444-555555555555';
const RX = '99999999-2222-4333-8444-555555555555';
const SITE = { id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42, label: 'Shop', status: 'active' } as never;
const NOW = new Date('2026-10-13T12:00:00.000Z');

function row(over: Partial<PrescriptionRow>): PrescriptionRow {
  return {
    id: RX, siteId: SITE_ID, ruleId: 'rage_on_element', area: 'ux', source: 'rule', subjectKey: '/checkout|button.pay', pagePath: '/checkout',
    captureId: null, status: 'measuring', finding: { issueId: 'issue-1' }, prescription: null, change: null, visual: null, impact: {},
    actionKind: 'fix', actionRef: 't=77;p=prev;l=live', acceptance: { metric: 'rage_rate', direction: 'down', minVisits: 200 },
    measured: null, dismissReason: null, decidedBy: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  } as PrescriptionRow;
}

function fakeDb(opts: { sessionRows?: unknown[] } = {}) {
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
  const db = {
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set });
        const chain: Record<string, unknown> = {};
        chain.where = () => chain;
        chain.returning = async () => [{ id: RX }];
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve);
        return chain;
      },
    }),
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy']) chain[m] = () => chain;
      chain.limit = async () => opts.sessionRows ?? [{ sessionId: 'sess-1' }];
      return chain;
    },
  };
  return { db: db as never, updates };
}

const measuredSet = (updates: Array<{ table: unknown; set: Record<string, unknown> }>) =>
  updates.find((u) => u.table === replayPrescriptions)?.set;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockClear();
  mocks.effectFor.mockReset();
  mocks.variantResults.mockReset();
  mocks.measureFollowUp.mockReset();
});

describe('VERIFIERS', () => {
  it('measures each action by its own instrument', () => {
    expect(Object.keys(VERIFIERS).sort()).toEqual(['apply_in_composer', 'apply_page', 'copy_prompt', 'fix', 'follow_up', 'test', 'ticket']);
    expect(VERIFIERS.fix).toBe(VERIFIERS.ticket);
    // Every hand-applied page fix is measured by the release that shipped it.
    expect(VERIFIERS.apply_page).toBe(VERIFIERS.copy_prompt);
    expect(VERIFIERS.apply_in_composer).toBe(VERIFIERS.copy_prompt);
  });
});

describe('fix / ticket → the ticket effect', () => {
  it('writes the verdict in the metric\'s direction, verifies the issue, and records the outcome', async () => {
    mocks.effectFor.mockResolvedValueOnce({
      taskId: 77, status: 'measured', metric: 'frustrated', route: '/checkout',
      before: { releaseKey: 'r9', sessions: 400, rate: 0.1 }, after: { releaseKey: 'r10', sessions: 300, rate: 0.08 }, delta: -0.02, minVisits: 200,
    });
    const { db, updates } = fakeDb();
    expect(await verifyPrescription({} as never, db, SITE, row({}), NOW)).toBe(true);
    expect(mocks.effectFor).toHaveBeenCalledWith({}, db, { tenantId: 7, taskId: 77 });
    expect(measuredSet(updates)).toMatchObject({
      status: 'worked',
      measured: { before: 0.1, after: 0.08, delta: -0.02, verdict: 'worked', source: 'ticket_effect', releaseKey: 'r10', measuredAt: NOW.toISOString() },
    });
    expect(updates.find((u) => u.table === replayIssues)?.set).toMatchObject({ status: 'verified' });
    expect(mocks.recordOutcomeEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      correlationId: RX, sessionId: 'sess-1', tenantId: 7, projectId: 42,
      action: 'prescription.verify', phase: 'validated', metricKey: 'rage_rate', metricValue: -0.02,
    }));
  });

  it('waits (writes nothing) until the effect is measured', async () => {
    mocks.effectFor.mockResolvedValueOnce({ status: 'waiting', delta: null, metric: 'conversions', before: { rate: 0.05 }, after: null });
    const { db, updates } = fakeDb();
    expect(await verifyPrescription({} as never, db, SITE, row({}), NOW)).toBe(false);
    expect(updates).toHaveLength(0);
    expect(mocks.recordOutcomeEvent).not.toHaveBeenCalled();
  });

  it('offers Revert when a published fix measured worse', async () => {
    mocks.effectFor.mockResolvedValueOnce({
      status: 'measured', metric: 'conversions', before: { releaseKey: 'r9', rate: 0.05 }, after: { releaseKey: 'r10', rate: 0.03 }, delta: -0.02,
    });
    const { db, updates } = fakeDb();
    const published = row({});
    await verifyPrescription({} as never, db, SITE, published, NOW);
    const after = toPrescriptionDto({ ...published, ...measuredSet(updates) } as PrescriptionRow);
    expect(after.status).toBe('worse');
    expect(after.next).toEqual(['revert']);
    expect(updates.find((u) => u.table === replayIssues)?.set).toMatchObject({ status: 'ongoing' });
  });
});

describe('test → variantResults', () => {
  const powered = (control: number, preview: number) => ({
    underpowered: false,
    variants: [
      { key: 'live', isControl: true, rate: control },
      { key: 'preview', isControl: false, rate: preview },
    ],
  });

  it('gives no verdict while either arm is under its minimum sample', async () => {
    mocks.variantResults.mockResolvedValueOnce({ underpowered: true, variants: [] });
    const { db, updates } = fakeDb();
    expect(await verifyPrescription({} as never, db, SITE, row({ actionKind: 'test', actionRef: 'x=55;p=prev' }), NOW)).toBe(false);
    expect(updates).toHaveLength(0);
    expect(mocks.stopTest).not.toHaveBeenCalled();
  });

  it('judges the preview against live once powered, and concludes the test', async () => {
    mocks.variantResults.mockResolvedValueOnce(powered(0.05, 0.06));
    const { db, updates } = fakeDb();
    expect(await verifyPrescription({} as never, db, SITE, row({ actionKind: 'test', actionRef: 'x=55;p=prev' }), NOW)).toBe(true);
    expect(measuredSet(updates)).toMatchObject({ status: 'worked', measured: { source: 'ab_test', before: 0.05, after: 0.06, releaseKey: 'prev' } });
    expect(mocks.stopTest).toHaveBeenCalledWith(db, {}, 7, expect.objectContaining({ type: 'system' }), 55, true);
  });
});

describe('follow_up → enrolled vs matched-not-enrolled', () => {
  it('writes the verdict from the two groups\' conversion', async () => {
    mocks.measureFollowUp.mockResolvedValueOnce({ before: 0.1, after: 0.3, delta: 0.2 });
    const { db, updates } = fakeDb({ sessionRows: [] });
    const SEQ = 'bbbbbbbb-cccc-4ddd-8eee-000000000001';
    expect(await verifyPrescription({} as never, db, SITE, row({ ruleId: 'pricing_hesitation', actionKind: 'follow_up', actionRef: `s=${SEQ}`, finding: {} }), NOW)).toBe(true);
    expect(mocks.measureFollowUp).toHaveBeenCalledWith({}, db, { tenantId: 7, siteId: SITE_ID }, expect.anything(), SEQ, NOW);
    expect(measuredSet(updates)).toMatchObject({ status: 'worked', measured: { source: 'follow_up', delta: 0.2 } });
    // No board linked to the project: the ledger records nothing rather than something wrong.
    expect(mocks.recordOutcomeEvent).not.toHaveBeenCalled();
  });

  it('leaves a decided or unacted prescription alone', async () => {
    const { db } = fakeDb();
    expect(await verifyPrescription({} as never, db, SITE, row({ status: 'worked' }), NOW)).toBe(false);
    expect(await verifyPrescription({} as never, db, SITE, row({ actionKind: null }), NOW)).toBe(false);
    expect(mocks.effectFor).not.toHaveBeenCalled();
  });
});
