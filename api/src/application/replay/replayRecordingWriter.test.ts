/**
 * The kept half of ingest: R2 + row + timeline + debit, and the three rules that make
 * it safe — a new recording needs the licence AND an allowance, a recording already
 * in progress always continues, and a retried chunk never stores, folds or charges
 * twice. R2 is an in-memory bucket; the wallet and the licence are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPLAY_SITE_SETTINGS, type ReplayChunk } from '@builderforce/interaction-contract';
import type { ReplaySiteRecord } from './replaySites';
import { REPLAY_UNIT_BYTES } from '../../domain/replay/billing';

const mocks = vi.hoisted(() => ({
  entitled: true,
  canKeep: true,
  chargeUnits: vi.fn(async () => ({ charged: true, source: 'free' as const })),
  noteAllowanceExhausted: vi.fn(async () => {}),
}));

vi.mock('./replayEntitlement', () => ({ replayEntitledForSite: vi.fn(async () => mocks.entitled) }));
vi.mock('./replayUsage', () => ({
  canKeepNewRecording: vi.fn(async () => mocks.canKeep),
  chargeUnits: mocks.chargeUnits,
  noteAllowanceExhausted: mocks.noteAllowanceExhausted,
}));

import { keepChunk, type RecordingRow } from './replayRecordingWriter';
import { chunkKey, marksKey } from './replayChunkStore';

const SITE: ReplaySiteRecord = {
  id: '11111111-2222-4333-8444-555555555555',
  tenantId: 7,
  kind: 'external',
  projectId: null,
  label: 'Shop',
  apiKeyId: 'k1',
  settings: DEFAULT_REPLAY_SITE_SETTINGS,
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const NOW = new Date('2026-10-12T10:00:00.000Z');
const STARTED = new Date('2026-10-12T09:59:00.000Z');

function bucket() {
  const objects = new Map<string, Uint8Array | string>();
  return {
    objects,
    put: vi.fn(async (key: string, value: Uint8Array | string) => { objects.set(key, value); }),
    head: vi.fn(async (key: string) => (objects.has(key) ? { key } : null)),
    get: vi.fn(async (key: string) => {
      const value = objects.get(key);
      if (value === undefined) return null;
      return { text: async () => String(value), arrayBuffer: async () => new Uint8Array(value as Uint8Array).buffer };
    }),
    list: vi.fn(async () => ({ objects: [], truncated: false, delimitedPrefixes: [] })),
    delete: vi.fn(async () => {}),
  };
}

/** A fake db: one recording (or none) for the visit lookup; captures the upsert. */
function fakeDb(existing: RecordingRow | null) {
  const upserts: Array<{ values: Record<string, unknown>; set: Record<string, unknown> }> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (existing ? [existing] : []) }) }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => ({
          returning: async () => {
            upserts.push({ values, set: opts.set });
            return [{ id: existing?.id ?? values.id, startedAt: existing?.startedAt ?? values.startedAt }];
          },
        }),
      }),
    }),
  };
  return { db: db as never, upserts };
}

function chunk(over: Partial<ReplayChunk> = {}): ReplayChunk {
  return {
    v: 1,
    visitorId: 'visitor_0001',
    visitId: 'visit_00001',
    seq: 0,
    startedAt: STARTED.getTime(),
    release: 'r1',
    recorderVersion: '1.0.0',
    device: { class: 'desktop', w: 1440, h: 900 },
    newVisitor: true,
    keep: 'sample',
    sampleWeight: 1,
    marks: [{ kind: 'page', key: '/pricing', atMs: 0 }, { kind: 'click', key: 'a.cta', atMs: 10, gx: 1, gy: 1 }],
    events: [{ type: 2 }],
    ...over,
  };
}

function existingRow(over: Partial<RecordingRow> = {}): RecordingRow {
  return {
    id: 'rec-existing', siteId: SITE.id, tenantId: 7, visitorId: 'visitor_0001', visitId: 'visit_00001',
    startedAt: STARTED, lastEventAt: STARTED, endedAt: null, durationMs: 0, activeMs: 0,
    entryPath: '/pricing', exitPath: '/pricing', pageCount: 1, releaseKey: 'r1', recorderVersion: '1.0.0',
    deviceClass: 'desktop', viewportW: 1440, viewportH: 900, browser: null, os: null, country: 'US', referrerHost: null,
    clickCount: 0, rageCount: 0, deadCount: 0, errorCount: 0, quickbackCount: 0, excessiveScrollCount: 0,
    converted: false, keepReason: 'sample', sampleWeight: 1, variant: null, identifiedId: null, traits: null,
    billableUnits: 1, chunkCount: 1, bytes: 1_000, routes: ['/pricing'], events: [], frustrations: [], clicked: [],
    issueFps: [], steps: ['page:/pricing'], tags: {}, createdAt: STARTED, updatedAt: STARTED,
    ...over,
  };
}

const gz = (size: number) => { const b = new Uint8Array(size); b[0] = 0x1f; b[1] = 0x8b; return b; };

beforeEach(() => {
  mocks.entitled = true;
  mocks.canKeep = true;
  mocks.chargeUnits.mockClear();
  mocks.noteAllowanceExhausted.mockClear();
});

describe('a new recording', () => {
  it('stores the chunk, writes the row and the timeline, and charges unit 1', async () => {
    const r2 = bucket();
    const { db, upserts } = fakeDb(null);
    const out = await keepChunk({ UPLOADS: r2 } as never, db, { site: SITE, chunk: chunk(), gzipped: gz(500), country: 'DE', now: NOW });

    expect(out.kind).toBe('stored');
    const recordingId = (out as { recordingId: string }).recordingId;
    const loc = { tenantId: 7, siteId: SITE.id, recordingId, startedAt: STARTED };
    expect(r2.objects.has(chunkKey(loc, 0))).toBe(true);
    expect(chunkKey(loc, 0)).toBe(`replay/t7/${SITE.id}/2026-10-12/${recordingId}/000000.ndjson.gz`);
    expect(JSON.parse(String(r2.objects.get(marksKey(loc))))).toHaveLength(2);
    expect(upserts[0]!.values).toMatchObject({
      siteId: SITE.id, tenantId: 7, visitId: 'visit_00001', bytes: 500, billableUnits: 1,
      entryPath: '/pricing', clickCount: 1, keepReason: 'sample', country: 'DE',
    });
    expect(mocks.chargeUnits).toHaveBeenCalledTimes(1);
    expect(mocks.chargeUnits).toHaveBeenCalledWith(expect.anything(), db, expect.objectContaining({ tenantId: 7, recordingId, unitIndex: 1 }));
  });

  it('is refused without the licence — nothing stored, nothing charged', async () => {
    mocks.entitled = false;
    const r2 = bucket();
    const { db, upserts } = fakeDb(null);
    const out = await keepChunk({ UPLOADS: r2 } as never, db, { site: SITE, chunk: chunk(), gzipped: gz(100), country: null, now: NOW });
    expect(out.kind).toBe('refused');
    expect(r2.objects.size).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(mocks.chargeUnits).not.toHaveBeenCalled();
  });

  it('is refused once the allowance is spent, and the exhaustion is traced', async () => {
    mocks.canKeep = false;
    const r2 = bucket();
    const { db, upserts } = fakeDb(null);
    const out = await keepChunk({ UPLOADS: r2 } as never, db, { site: SITE, chunk: chunk(), gzipped: gz(100), country: null, now: NOW });
    expect(out.kind).toBe('refused');
    expect(r2.objects.size).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(mocks.noteAllowanceExhausted).toHaveBeenCalledWith(expect.anything(), db, expect.objectContaining({ tenantId: 7, siteId: SITE.id }));
  });
});

describe('a recording in progress', () => {
  it('continues even with the allowance spent, and charges only a newly crossed unit', async () => {
    mocks.canKeep = false;
    const r2 = bucket();
    const { db, upserts } = fakeDb(existingRow({ bytes: REPLAY_UNIT_BYTES - 10, billableUnits: 1 }));
    const out = await keepChunk({ UPLOADS: r2 } as never, db, {
      site: SITE, chunk: chunk({ seq: 1, marks: [{ kind: 'rage', key: 'button.x', atMs: 30_000, gx: 2, gy: 2 }] }),
      gzipped: gz(100), country: null, now: NOW,
    });
    expect(out).toMatchObject({ kind: 'stored', recordingId: 'rec-existing' });
    expect(upserts[0]!.set).toMatchObject({ bytes: REPLAY_UNIT_BYTES + 90, billableUnits: 2, rageCount: 1, chunkCount: 2, entryPath: '/pricing' });
    expect(mocks.chargeUnits).toHaveBeenCalledTimes(1);
    expect(mocks.chargeUnits).toHaveBeenCalledWith(expect.anything(), db, expect.objectContaining({ recordingId: 'rec-existing', unitIndex: 2 }));
  });

  it('charges nothing while the recording stays inside its charged units', async () => {
    const { db } = fakeDb(existingRow({ bytes: 1_000, billableUnits: 1 }));
    await keepChunk({ UPLOADS: bucket() } as never, db, { site: SITE, chunk: chunk({ seq: 1 }), gzipped: gz(100), country: null, now: NOW });
    expect(mocks.chargeUnits).not.toHaveBeenCalled();
  });

  it('treats a retried chunk as a duplicate: no fold, no store, no charge', async () => {
    const row = existingRow({ bytes: REPLAY_UNIT_BYTES - 10, billableUnits: 1 });
    const r2 = bucket();
    r2.objects.set(chunkKey({ tenantId: 7, siteId: SITE.id, recordingId: row.id, startedAt: row.startedAt }, 1), gz(100));
    const { db, upserts } = fakeDb(row);
    const out = await keepChunk({ UPLOADS: r2 } as never, db, { site: SITE, chunk: chunk({ seq: 1 }), gzipped: gz(100), country: null, now: NOW });
    expect(out.kind).toBe('duplicate');
    expect(upserts).toHaveLength(0);
    expect(r2.put).not.toHaveBeenCalled();
    expect(mocks.chargeUnits).not.toHaveBeenCalled();
  });
});
