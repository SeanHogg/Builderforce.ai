/**
 * The ingest orchestration (PRD 33 §3.3): what reaches the rollups, what reaches
 * the kept path, and what is dropped without a trace. The site lookup, the kept
 * writer, the flush and the traces are mocked; the body decoding, the rollup fold
 * and the buffer are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPLAY_SITE_SETTINGS, type ReplayChunk } from '@builderforce/interaction-contract';
import type { ReplaySiteRecord } from './replaySites';

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

const mocks = vi.hoisted(() => ({
  resolveSiteForIngest: vi.fn(),
  keepChunk: vi.fn(),
  flushReplayRollups: vi.fn(async () => {}),
  recordReplayTrace: vi.fn(async () => {}),
  purgeStaleLive: vi.fn(async () => {}),
}));

vi.mock('./replaySites', () => ({ resolveSiteForIngest: mocks.resolveSiteForIngest }));
vi.mock('./replayRecordingWriter', () => ({ keepChunk: mocks.keepChunk }));
vi.mock('./replayRollupFlush', () => ({ flushReplayRollups: mocks.flushReplayRollups }));
vi.mock('./replayRetention', () => ({ purgeStaleLive: mocks.purgeStaleLive }));
vi.mock('./replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: { ingestFirstEvent: 'replay.ingest.first_event' },
}));

import { ReplayIngestService, releaseSource, type ReplayIngestRequest } from './ReplayIngestService';
import { ReplayRollupBuffer } from './replayRollupBuffer';
import { gzip } from './replayIngestBody';

const NOW = new Date('2026-10-12T10:00:00.000Z');
const env = {} as never;
const db = {} as never;

function chunk(over: Partial<ReplayChunk> = {}): ReplayChunk {
  return {
    v: 1,
    visitorId: 'visitor_0001',
    visitId: 'visit_00001',
    seq: 0,
    startedAt: NOW.getTime() - 5_000,
    release: 'abcdef123456',
    recorderVersion: '1.0.0',
    device: { class: 'desktop', w: 1440, h: 900 },
    newVisitor: true,
    keep: null,
    sampleWeight: 1,
    marks: [{ kind: 'page', key: '/pricing', atMs: 0 }],
    ...over,
  };
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function request(body: Uint8Array | ArrayBuffer, over: Partial<ReplayIngestRequest> = {}): ReplayIngestRequest {
  const buffer = body instanceof Uint8Array ? body.slice().buffer : body;
  return {
    siteToken: 'bfr_test',
    origin: 'https://shop.example.com',
    ip: '203.0.113.9',
    country: 'US',
    contentEncoding: null,
    body: buffer as ArrayBuffer,
    ...over,
  };
}

let buffer: ReplayRollupBuffer;
const service = () => new ReplayIngestService(env, db, { now: () => NOW, buffer });

beforeEach(() => {
  buffer = new ReplayRollupBuffer({ maxPending: 10_000, maxAgeMs: 60_000, now: () => NOW.getTime() });
  mocks.resolveSiteForIngest.mockReset().mockResolvedValue(SITE);
  mocks.keepChunk.mockReset();
  mocks.flushReplayRollups.mockClear();
  mocks.recordReplayTrace.mockClear();
});

describe('dropped before anything is written', () => {
  it('drops a chunk whose key or origin does not resolve', async () => {
    mocks.resolveSiteForIngest.mockResolvedValue(null);
    expect(await service().ingest(request(json(chunk())))).toBe('dropped');
    expect(buffer.pendingCount).toBe(0);
    expect(mocks.keepChunk).not.toHaveBeenCalled();
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
  });

  it('passes the token and origin to the site resolution', async () => {
    await service().ingest(request(json(chunk()), { origin: 'https://evil.example' }));
    expect(mocks.resolveSiteForIngest).toHaveBeenCalledWith(env, db, 'bfr_test', 'https://evil.example');
  });

  it('drops a disabled site', async () => {
    mocks.resolveSiteForIngest.mockResolvedValue({ ...SITE, status: 'disabled' });
    expect(await service().ingest(request(json(chunk())))).toBe('dropped');
    expect(buffer.pendingCount).toBe(0);
  });

  it('drops an oversize body without resolving anything from it', async () => {
    const big = new Uint8Array(600_000).fill(32);
    expect(await service().ingest(request(big))).toBe('dropped');
    expect(buffer.pendingCount).toBe(0);
  });

  it('drops an invalid chunk', async () => {
    expect(await service().ingest(request(json({ v: 2 })))).toBe('dropped');
    expect(await service().ingest(request(new TextEncoder().encode('not json')))).toBe('dropped');
    expect(buffer.pendingCount).toBe(0);
  });

  it('never throws, even when the site lookup does', async () => {
    mocks.resolveSiteForIngest.mockRejectedValue(new Error('db down'));
    await expect(service().ingest(request(json(chunk())))).resolves.toBe('dropped');
  });
});

describe('an unkept chunk', () => {
  it('rolls up without touching the kept path', async () => {
    expect(await service().ingest(request(json(chunk())))).toBe('counted');
    expect(mocks.keepChunk).not.toHaveBeenCalled();
    const batch = buffer.drain();
    expect(batch.routes).toEqual([expect.objectContaining({ route: '/pricing', sessions: 1, siteId: SITE.id, tenantId: 7, day: '2026-10-12' })]);
    expect(batch.releases).toEqual([expect.objectContaining({ releaseKey: 'abcdef123456', source: 'fingerprint' })]);
    expect(batch.live).toEqual([expect.objectContaining({ visitId: 'visit_00001', recordingId: null })]);
  });

  it('reads a gzip body by its magic bytes, with or without the header', async () => {
    const zipped = await gzip(json(chunk()));
    expect(await service().ingest(request(zipped, { contentEncoding: null }))).toBe('counted');
    expect(await service().ingest(request(zipped, { contentEncoding: 'gzip' }))).toBe('counted');
  });

  it('traces the site’s first event', async () => {
    await service().ingest(request(json(chunk())));
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(env, db, expect.objectContaining({
      tenantId: 7, siteId: SITE.id, verb: 'replay.ingest.first_event',
    }));
  });
});

describe('a kept chunk', () => {
  const kept = () => chunk({ keep: 'sample', events: [{ type: 2 }] });

  it('stores through the kept path (compressed) and links the recording to live presence', async () => {
    mocks.keepChunk.mockResolvedValue({ kind: 'stored', recordingId: 'rec-1', prev: null });
    expect(await service().ingest(request(json(kept())))).toBe('kept');
    const input = mocks.keepChunk.mock.calls[0]![2];
    expect(input.site).toBe(SITE);
    expect(input.chunk.visitId).toBe('visit_00001');
    expect([input.gzipped[0], input.gzipped[1]]).toEqual([0x1f, 0x8b]);
    expect(buffer.drain().live[0]).toMatchObject({ recordingId: 'rec-1' });
  });

  it('still counts the session when a new recording is refused (allowance spent)', async () => {
    mocks.keepChunk.mockResolvedValue({ kind: 'refused', prev: null });
    expect(await service().ingest(request(json(kept())))).toBe('counted');
    expect(buffer.drain().routes[0]).toMatchObject({ sessions: 1 });
  });

  it('does not roll a retried chunk up a second time', async () => {
    mocks.keepChunk.mockResolvedValue({ kind: 'duplicate', recordingId: 'rec-1', prev: {} });
    expect(await service().ingest(request(json(kept())))).toBe('duplicate');
    expect(buffer.pendingCount).toBe(0);
  });

  it('still counts the chunk when storage fails', async () => {
    mocks.keepChunk.mockRejectedValue(new Error('R2 unavailable'));
    expect(await service().ingest(request(json(kept())))).toBe('counted');
    expect(buffer.drain().routes[0]).toMatchObject({ sessions: 1 });
  });
});

describe('releaseSource', () => {
  it('reads a 12-hex key as a fingerprint, a hosted site key as hosted, else explicit', () => {
    expect(releaseSource(SITE, 'abcdef123456')).toBe('fingerprint');
    expect(releaseSource({ ...SITE, kind: 'hosted' }, 'v-20261012')).toBe('hosted');
    expect(releaseSource(SITE, '2026.10.1')).toBe('explicit');
  });
});
