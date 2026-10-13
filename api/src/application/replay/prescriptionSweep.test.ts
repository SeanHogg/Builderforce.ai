/**
 * The prescription sweep and its AI drafts (PRD 33 §5.1.1–3):
 *   • upsert by subject — an open row is refreshed, a new subject is inserted;
 *   • a subject dismissed in the last 30 days stays dismissed;
 *   • the finding's issue group is linked (`prescription_id`, status `proposed`);
 *   • drafts: at most five per site per day, through the SHARED Insights AI budget;
 *     uncited sentences are dropped; the prompt is numbered lines of facts, element
 *     selectors + labels and timelines — never page text;
 *   • "Find fixes now" runs once an hour per site.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteAggregates } from '../../domain/replay/prescriptions/types';

const mocks = vi.hoisted(() => ({
  aggregates: null as unknown as SiteAggregates,
  draftPrescriptions: vi.fn(async () => 0),
  condenseTranscript: vi.fn(),
  getMarks: vi.fn(async () => [] as unknown[]),
  getChunk: vi.fn(),
}));
vi.mock('./prescriptionAggregates', () => ({
  PRESCRIPTION_WINDOW_DAYS: 30,
  buildSiteAggregates: vi.fn(async () => mocks.aggregates),
}));
vi.mock('./prescriptionDraft', () => ({ draftPrescriptions: mocks.draftPrescriptions }));
vi.mock('./prescriptionVerify', () => ({ verifySite: vi.fn(async () => 0) }));
vi.mock('../llm/condense', () => ({ condenseTranscript: mocks.condenseTranscript }));
vi.mock('./replayChunkStore', () => ({ getMarks: mocks.getMarks, getChunk: mocks.getChunk }));
vi.mock('./replaySites', () => ({
  getSite: vi.fn(async () => SITE),
  getSiteForTenant: vi.fn(async () => SITE),
}));

import { replayIssues, replayPrescriptions } from '../../infrastructure/database/schema';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { PrescriptionSweepLimitError, sweepNow, sweepSite } from './prescriptionSweep';
import { REPLAY_SUMMARY_DAILY_LIMIT } from './replayAiBudget';
import type { PrescriptionRow } from './prescriptionReads';

const SITE_ID = '11111111-2222-4333-8444-555555555555';
const SITE = { id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42, label: 'Shop', apiKeyId: null, settings: {}, status: 'active', createdAt: '' } as never;
const NOW = new Date('2026-10-13T12:00:00.000Z');

function baseAggregates(): SiteAggregates {
  return {
    siteId: SITE_ID, days: 30, grid: 50, site: { sessions: 2_000, conversions: 70 },
    routes: [{ route: '/checkout', sessions: 400, pageviews: 400 }],
    issues: [
      { id: 'issue-rage', fingerprint: 'fp-rage', kind: 'rage', route: '/checkout', subject: 'button.pay', title: 'Rage clicks on Pay', status: 'new',
        sessions: 20, share: 0.05, routeSessions: 400, recordingIds: ['aaaaaaaa-bbbb-4ccc-8ddd-000000000001'], cohorts: null },
      { id: 'issue-qb', fingerprint: 'fp-qb', kind: 'quickback', route: '/pricing', subject: '/pricing', title: 'Quick backs from /pricing', status: 'new',
        sessions: 40, share: 0.2, routeSessions: 200, recordingIds: [], cohorts: null },
    ],
    elements: [], scroll: [], funnelSteps: [],
    devices: [{ value: 'desktop', sessions: 1_000, conversions: 50 }, { value: 'phone', sessions: 1_000, conversions: 20 }],
    releases: [], knownCohorts: [], proofs: [], patterns: [],
  };
}

function row(over: Partial<PrescriptionRow>): PrescriptionRow {
  return {
    id: 'rx-1', siteId: SITE_ID, ruleId: 'rage_on_element', area: 'ux', source: 'rule', subjectKey: '/checkout|button.pay', pagePath: '/checkout',
    captureId: null, status: 'proposed', finding: {}, prescription: null, change: null, visual: null, impact: {}, actionKind: null, actionRef: null,
    acceptance: null, measured: null, dismissReason: null, decidedBy: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  } as PrescriptionRow;
}

/** select → the queued rows; insert/update are recorded and answer `returning` with the written values. */
function fakeDb(existing: PrescriptionRow[]) {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
  const selects = [existing];
  let n = 0;
  const thenable = (rows: unknown, chain: Record<string, unknown>) => {
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };
  const db = {
    select: () => {
      const rows = selects.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'groupBy', 'limit']) chain[m] = () => chain;
      return thenable(rows, chain);
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const chain: Record<string, unknown> = {};
        chain.onConflictDoNothing = () => chain;
        chain.returning = async () => [{ ...row({}), ...values, id: `new-${++n}` }];
        return thenable(undefined, chain);
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set });
        const chain: Record<string, unknown> = {};
        chain.where = () => chain;
        chain.returning = async () => [{ ...row({}), ...set }];
        return thenable(undefined, chain);
      },
    }),
  };
  return { db: db as never, inserts, updates };
}

beforeEach(() => {
  __clearL1CacheForTests();
  mocks.aggregates = baseAggregates();
  mocks.draftPrescriptions.mockClear();
  mocks.condenseTranscript.mockReset();
  mocks.getMarks.mockReset();
  mocks.getMarks.mockResolvedValue([]);
  mocks.getChunk.mockReset();
});

describe('sweepSite', () => {
  it('refreshes an open row by subject, inserts a new subject, and links its issue group', async () => {
    const { db, inserts, updates } = fakeDb([row({ id: 'rx-open', ruleId: 'rage_on_element', subjectKey: '/checkout|button.pay' })]);
    const out = await sweepSite({} as never, db, SITE, { now: NOW });

    expect(out).toMatchObject({ found: 3, refreshed: 1, created: 2 });
    const rxInserts = inserts.filter((i) => i.table === replayPrescriptions).map((i) => i.values);
    expect(rxInserts.map((v) => v.ruleId).sort()).toEqual(['device_gap', 'quickback_after_reveal']);
    expect(rxInserts.find((v) => v.ruleId === 'device_gap')).toMatchObject({
      status: 'proposed', area: 'site', subjectKey: 'device:phone',
      acceptance: { metric: 'phone_conversion_rate', direction: 'up', minVisits: 500 },
      // 1 000 sessions on each side and a range clear of zero: a high-confidence estimate.
      impact: expect.objectContaining({ confidence: 'high', unit: 'conversions', basis: expect.anything() }),
    });
    const refresh = updates.find((u) => u.table === replayPrescriptions)!;
    expect(refresh.set).toMatchObject({ pagePath: '/checkout', finding: expect.objectContaining({ issueId: 'issue-rage', fingerprint: 'fp-rage' }) });
    expect(refresh.set).not.toHaveProperty('status'); // the sweep never writes the action columns
    const links = updates.filter((u) => u.table === replayIssues).map((u) => u.set);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ prescriptionId: 'rx-open', status: 'proposed' }),
      expect.objectContaining({ status: 'proposed' }),
    ]));
  });

  it('keeps a subject dismissed in the last 30 days dismissed', async () => {
    const { db, inserts, updates } = fakeDb([row({ id: 'rx-d', ruleId: 'device_gap', subjectKey: 'device:phone', status: 'dismissed', dismissReason: 'phones are a different product' })]);
    const out = await sweepSite({} as never, db, SITE, { now: NOW });
    expect(inserts.map((i) => i.values.ruleId)).not.toContain('device_gap');
    expect(updates.filter((u) => u.table === replayPrescriptions)).toHaveLength(0);
    expect(out.created).toBe(2);
  });

  it('hands only new, undrafted proposals to the drafter, ranked', async () => {
    const { db } = fakeDb([]);
    await sweepSite({} as never, db, SITE, { now: NOW });
    const rows = (mocks.draftPrescriptions.mock.calls[0] as unknown[])[3] as PrescriptionRow[];
    expect(rows).toHaveLength(3);
    // device_gap has a measured impact, the two issue findings have none (low) → it ranks first.
    expect(rows[0]!.ruleId).toBe('device_gap');
  });
});

describe('sweepNow', () => {
  it('runs once an hour per site', async () => {
    const env = {} as never;
    await sweepNow(env, fakeDb([]).db, { tenantId: 7, siteId: SITE_ID }, { now: NOW });
    await expect(sweepNow(env, fakeDb([]).db, { tenantId: 7, siteId: SITE_ID }, { now: NOW })).rejects.toBeInstanceOf(PrescriptionSweepLimitError);
  });
});

describe('draftPrescriptions (the real drafter)', () => {
  const draftAgg = { elements: [{ route: '/checkout', selector: 'button.pay', label: 'Pay', clicks: 30, rage: 12, dead: 0, medianGy: 10 }] };
  const drafted = (i: number) => row({ id: `rx-${i}`, finding: { params: { route: '/checkout', share: 5 }, evidence: [], selector: 'button.pay', label: 'Pay' } });
  /** A KV double, optionally starting the AI budget at `budgetUsed`. */
  const kvEnv = (budgetUsed = 0) => {
    const store = new Map<string, string>();
    return {
      AUTH_CACHE_KV: {
        get: async (k: string) => store.get(k) ?? (k.startsWith('replay:ai-budget') && budgetUsed ? String(budgetUsed) : null),
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
      },
    } as never;
  };

  it('drafts at most five a day per site, dropping uncited sentences and keeping only known targets', async () => {
    const { draftPrescriptions } = await vi.importActual<typeof import('./prescriptionDraft')>('./prescriptionDraft');
    mocks.condenseTranscript.mockResolvedValue({
      text: 'PRESCRIPTION: Make Pay respond to the first tap #1. It is obviously broken.\n'
        + 'CHANGE: {"kind":"code","target":"button.pay","description":"Debounce the handler"}\n'
        + 'ACCEPTANCE: rage_rate down 300',
    });
    const { db, updates } = fakeDb([]);
    const written = await draftPrescriptions(kvEnv(), db, SITE, [1, 2, 3, 4, 5, 6, 7].map(drafted), draftAgg, NOW);
    expect(written).toBe(5);
    expect(mocks.condenseTranscript).toHaveBeenCalledTimes(5);
    expect(updates[0]!.set).toMatchObject({
      prescription: 'Make Pay respond to the first tap #1.',
      change: { kind: 'code', target: 'button.pay', description: 'Debounce the handler' },
      acceptance: { metric: 'rage_rate', direction: 'down', minVisits: 300 },
    });
  });

  it('shares the workspace\'s Insights AI budget and writes nothing for an all-uncited answer', async () => {
    const { draftPrescriptions } = await vi.importActual<typeof import('./prescriptionDraft')>('./prescriptionDraft');
    const spent = fakeDb([]);
    expect(await draftPrescriptions(kvEnv(REPLAY_SUMMARY_DAILY_LIMIT), spent.db, SITE, [drafted(1)], draftAgg, NOW)).toBe(0);
    expect(mocks.condenseTranscript).not.toHaveBeenCalled();

    mocks.condenseTranscript.mockResolvedValueOnce({ text: 'PRESCRIPTION: Trust me, it is the button.\nCHANGE: {"kind":"code","target":"div.secret","description":"x"}' });
    const uncited = fakeDb([]);
    expect(await draftPrescriptions(kvEnv(), uncited.db, SITE, [drafted(2)], draftAgg, NOW)).toBe(0);
    expect(uncited.updates).toHaveLength(0);
  });

  it('puts only numbered facts, element selectors + labels and timelines in the prompt — never page text', async () => {
    const { buildDraftTranscript } = await vi.importActual<typeof import('./prescriptionDraft')>('./prescriptionDraft');
    const recordingId = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
    mocks.getMarks.mockResolvedValueOnce([{ kind: 'rage', key: 'button.pay', label: 'Pay', atMs: 6_000 }]);
    const recording = {
      id: recordingId, siteId: SITE_ID, tenantId: 7, startedAt: NOW, durationMs: 9_000, entryPath: '/', exitPath: '/checkout',
      releaseKey: 'r1', deviceClass: 'phone', browser: 'Safari', os: 'iOS', tags: {}, visitId: 'v', visitorId: 'v', pageCount: 2,
      clickCount: 1, rageCount: 1, deadCount: 0, errorCount: 0, quickbackCount: 0, excessiveScrollCount: 0, converted: false, activeMs: 1,
      keepReason: 'frustration', sampleWeight: 1, frustrations: ['rage'], routes: ['/checkout'], events: [], clicked: [], issueFps: [], steps: [],
    };
    const { db } = fakeDb([]);
    (db as unknown as { select: () => unknown }).select = () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([recording]).then(resolve);
      return chain;
    };
    const prompt = await buildDraftTranscript({} as never, db, SITE, {
      ruleId: 'rage_on_element', pagePath: '/checkout',
      finding: { params: { route: '/checkout', share: 5 }, evidence: [{ recordingId, atMs: 0 }] },
      impact: { low: 2, high: 9, unit: 'conversions', confidence: 'medium', horizonDays: 30 },
    }, draftAgg);
    const lines = prompt.transcript.split('\n');
    for (const line of lines) {
      expect(line).toMatch(/^(\[#\d+\] |\[\d{2}:\d{2} #\d+\] |recording |visit: |path: |tags: )/);
    }
    expect(prompt.transcript).toContain('[#2] element button.pay "Pay"');
    expect(prompt.transcript).toContain('[00:06 #3] rage button.pay "Pay"');
    expect(prompt.lines).toBe(4);
    expect(mocks.getChunk).not.toHaveBeenCalled(); // no DOM snapshot is ever read
  });
});
