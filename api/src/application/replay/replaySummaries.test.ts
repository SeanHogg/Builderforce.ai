/**
 * Cited summaries: uncited sentences are dropped, a stored summary is served
 * without a model call, the daily budget is spent only on a model call and its
 * exhaustion is the 429 `limit` error, and generation is traced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayMark } from '@builderforce/interaction-contract';

const mocks = vi.hoisted(() => ({
  condenseTranscript: vi.fn(),
  getMarks: vi.fn(),
  recordReplayTrace: vi.fn(async () => {}),
}));
vi.mock('../llm/condense', () => ({ condenseTranscript: mocks.condenseTranscript }));
vi.mock('./replayChunkStore', () => ({ getMarks: mocks.getMarks }));
vi.mock('./replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: { summaryGenerated: 'replay.summary.generated' },
}));

import { summarizeRecording, summarizeSegment } from './replaySummaries';
import { REPLAY_SUMMARY_DAILY_LIMIT, ReplayAiLimitError } from './replayAiBudget';

const SITE = '11111111-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE };
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const NOW = new Date();

const MARKS: ReplayMark[] = [
  { kind: 'page', key: '/', atMs: 0 },
  { kind: 'click', key: 'button.pay', label: 'Pay', atMs: 4_000 },
  { kind: 'rage', key: 'button.pay', label: 'Pay', atMs: 6_000 },
];

const recording = {
  id: REC, siteId: SITE, tenantId: 7, visitorId: 'v1', visitId: 'visit1', startedAt: NOW, lastEventAt: NOW, endedAt: null,
  durationMs: 10_000, activeMs: 8_000, entryPath: '/', exitPath: '/checkout', pageCount: 2, releaseKey: 'r1', recorderVersion: '1',
  deviceClass: 'phone', viewportW: 390, viewportH: 844, browser: 'Safari', os: 'iOS', country: 'US', referrerHost: null,
  clickCount: 2, rageCount: 1, deadCount: 0, errorCount: 0, quickbackCount: 0, excessiveScrollCount: 0, converted: false,
  keepReason: 'frustration', sampleWeight: 1, variant: null, identifiedId: null, traits: null, billableUnits: 1, chunkCount: 1,
  bytes: 100, routes: ['/'], events: [], frustrations: ['rage'], clicked: ['button.pay'], issueFps: [], steps: ['page:/'], tags: {},
  createdAt: NOW, updatedAt: NOW,
};

/** A KV double for the budget. */
function kv(start = 0) {
  const store = new Map<string, string>();
  return {
    store,
    binding: {
      get: async (k: string) => store.get(k) ?? (start ? String(start) : null),
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
  };
}

/** select → [recording] then the stored summary (if any); insert → upsert recorder. */
function fakeDb(stored: unknown[] = []) {
  const answers: unknown[][] = [[recording], stored];
  const upserts: unknown[] = [];
  let i = 0;
  const db = {
    select: () => {
      const rows = answers[i++] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy']) chain[m] = () => chain;
      chain.limit = async () => rows;
      return chain;
    },
    insert: () => ({ values: (v: unknown) => ({ onConflictDoUpdate: async () => { upserts.push(v); } }) }),
  };
  return { db: db as never, upserts, selects: () => i };
}

beforeEach(() => {
  mocks.condenseTranscript.mockReset();
  mocks.getMarks.mockReset();
  mocks.getMarks.mockResolvedValue(MARKS);
  mocks.recordReplayTrace.mockClear();
});

describe('summarizeRecording', () => {
  it('keeps only cited sentences, stores the citations with their times, and traces', async () => {
    mocks.condenseTranscript.mockResolvedValueOnce({ text: 'They opened the home page #0. They seemed annoyed. They rage-clicked Pay #2. Then they bought a car #7.' });
    const { db, upserts } = fakeDb();
    const out = await summarizeRecording({} as never, db, SCOPE, REC, { actorId: 'u1' });
    expect(out.summary).toBe('They opened the home page #0. They rage-clicked Pay #2.');
    expect(out.citations).toEqual([{ atMs: 0, ord: 0 }, { atMs: 6_000, ord: 2 }]);
    expect(upserts[0]).toMatchObject({ recordingId: REC, summary: out.summary, citations: out.citations });
    // The model read the digest (timeline lines), on the workspace's own tenant.
    expect(mocks.condenseTranscript).toHaveBeenCalledWith({}, 7, expect.objectContaining({
      transcript: expect.stringContaining('[00:06 #2] rage button.pay "Pay"'),
    }));
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith({}, db, expect.objectContaining({ verb: 'replay.summary.generated', tenantId: 7, siteId: SITE, actorId: 'u1' }));
  });

  it('serves the stored summary on the second call without a model call', async () => {
    const stored = [{ recordingId: REC, summary: 'Stored #1.', citations: [{ atMs: 4_000, ord: 1 }], model: null, generatedAt: NOW }];
    const { db } = fakeDb(stored);
    const out = await summarizeRecording({} as never, db, SCOPE, REC);
    expect(out).toEqual({ recordingId: REC, summary: 'Stored #1.', citations: [{ atMs: 4_000, ord: 1 }], model: null, generatedAt: NOW.toISOString() });
    expect(mocks.condenseTranscript).not.toHaveBeenCalled();
  });

  it('refuses with the limit error once the daily budget is spent, before any model call', async () => {
    const { binding } = kv(REPLAY_SUMMARY_DAILY_LIMIT);
    const { db } = fakeDb();
    const err = await summarizeRecording({ AUTH_CACHE_KV: binding } as never, db, SCOPE, REC).catch((e) => e);
    expect(err).toBeInstanceOf(ReplayAiLimitError);
    expect(err.status).toBe(429);
    expect(mocks.condenseTranscript).not.toHaveBeenCalled();
  });

  it('counts a model call against the budget', async () => {
    mocks.condenseTranscript.mockResolvedValueOnce({ text: 'Home #0.' });
    const { binding, store } = kv();
    await summarizeRecording({ AUTH_CACHE_KV: binding } as never, fakeDb().db, SCOPE, REC);
    expect([...store.values()]).toContain('1');
  });

  it('is a 404 outside the scope', async () => {
    const db = { select: () => { const c: Record<string, unknown> = {}; c.from = () => c; c.where = () => c; c.limit = async () => []; return c; } };
    await expect(summarizeRecording({} as never, db as never, SCOPE, REC)).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('summarizeSegment', () => {
  it('samples, cites recording#ord, and caches the answer for the hour', async () => {
    mocks.condenseTranscript.mockResolvedValue({ text: `Visitors rage-click Pay [${REC}#2].\nUncited pattern.` });
    const { db } = fakeDb();
    const first = await summarizeSegment({} as never, db, SCOPE, { days: 7 });
    expect(first.sampled).toBe(1);
    expect(first.patterns).toEqual([{ text: 'Visitors rage-click Pay.', examples: [{ recordingId: REC, atMs: 6_000 }] }]);
    const second = await summarizeSegment({} as never, db, SCOPE, { days: 7 });
    expect(second).toEqual(first);
    expect(mocks.condenseTranscript).toHaveBeenCalledTimes(1);
  });
});
