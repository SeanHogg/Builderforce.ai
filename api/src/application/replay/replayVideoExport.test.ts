/**
 * MP4 export (S4b): `unavailable` honestly and free when no runner is provisioned;
 * one dispatch per live export; the runner's capability token names one export; the
 * status machine; and the 10 units charged exactly once — on delivery, never on a
 * retried upload. The export table is an in-memory stand-in that applies the REAL
 * transition table; the usage module, the runner dispatch and the recording read are
 * mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string; tenantId: number; siteId: string; recordingId: string; status: string;
  format: string | null; r2Key: string | null; error: string | null; requestedBy: string | null;
  createdAt: Date; updatedAt: Date;
};

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  provisioned: true,
  manifest: { player: { url: 'https://cdn.test/replay/r/player.abc.js', cssUrl: 'https://cdn.test/replay/r/player.def.css' } } as unknown,
  dispatchQaRunnerJob: vi.fn(async (_env: unknown, _job: unknown) => true),
  hasUnits: vi.fn(async () => true),
  chargeUnits: vi.fn(async () => ({ charged: true, source: 'free' })),
  listChunkSeqs: vi.fn(async () => [3, 4]),
  getRecording: vi.fn(async () => ({
    id: 'rec', startedAt: '2026-10-12T09:00:00.000Z', viewport: { w: 1280, h: 720 }, durationMs: 60_000,
  })),
  chunk: vi.fn(async () => new Uint8Array([0x1f, 0x8b]).buffer),
}));

vi.mock('../qa/dispatchQaRunner', () => ({
  dispatchQaRunnerJob: mocks.dispatchQaRunnerJob,
  qaRunnerProvisioned: () => mocks.provisioned,
}));
vi.mock('./ReplayConfigService', () => ({ loadRecorderManifest: vi.fn(async () => mocks.manifest) }));
vi.mock('./replayUsage', () => ({ hasUnits: mocks.hasUnits, chargeUnits: mocks.chargeUnits }));
vi.mock('./replayChunkStore', () => ({ listChunkSeqs: mocks.listChunkSeqs }));
vi.mock('./ReplayReadService', () => ({
  ReplayReadService: vi.fn(function ReplayReadService() { return { getRecording: mocks.getRecording, chunk: mocks.chunk }; }),
}));
vi.mock('./replayExportStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./replayExportStore')>();
  const copy = (row: Row | undefined) => (row ? { ...row } : null);
  return {
    ...real,
    insertExport: vi.fn(async (_db: unknown, input: { scope: { tenantId: number; siteId: string }; recordingId: string; requestedBy: string | null; status: string; error?: string | null }) => {
      const now = new Date();
      const row: Row = {
        id: crypto.randomUUID(), tenantId: input.scope.tenantId, siteId: input.scope.siteId, recordingId: input.recordingId,
        status: input.status, format: null, r2Key: null, error: input.error ?? null, requestedBy: input.requestedBy,
        createdAt: now, updatedAt: now,
      };
      mocks.rows.set(row.id, row);
      return { ...row };
    }),
    findExport: vi.fn(async (_db: unknown, scope: { tenantId: number; siteId: string }, id: string) => {
      const row = mocks.rows.get(id);
      return row && row.tenantId === scope.tenantId && row.siteId === scope.siteId ? copy(row) : null;
    }),
    findExportForRunner: vi.fn(async (_db: unknown, tenantId: number, id: string) => {
      const row = mocks.rows.get(id);
      return row && row.tenantId === tenantId ? copy(row) : null;
    }),
    findReusableExport: vi.fn(async (_db: unknown, scope: { tenantId: number; siteId: string }, recordingId: string, since: Date) => {
      const live = [...mocks.rows.values()]
        .filter((r) => r.tenantId === scope.tenantId && r.siteId === scope.siteId && r.recordingId === recordingId)
        .filter((r) => ['queued', 'running', 'done'].includes(r.status) && r.createdAt >= since)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return copy(live[0]);
    }),
    moveExport: vi.fn(async (_db: unknown, tenantId: number, id: string, to: 'running' | 'done' | 'failed', patch: Record<string, unknown> = {}) => {
      const row = mocks.rows.get(id);
      if (!row || row.tenantId !== tenantId || !real.EXPORT_TRANSITIONS[to].includes(row.status as never)) return null;
      Object.assign(row, { status: to, ...patch, updatedAt: new Date() });
      return { ...row };
    }),
  };
});

import {
  authorizeExportRunner,
  downloadExport,
  exportStatus,
  mintExportToken,
  REPLAY_EXPORT_UNITS,
  requestExport,
  runnerReport,
  runnerUpload,
} from './replayVideoExport';

const SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SCOPE = { tenantId: 7, siteId: SITE };
const db = {} as never;
const put = vi.fn(async () => {});
const get = vi.fn(async () => ({ body: new ReadableStream(), size: 3 }));
const env = {
  JWT_SECRET: 'replay-export-test-secret-0123456789abcdef',
  INTERNAL_API_BASE_URL: 'https://api.test/',
  UPLOADS: { put, get },
} as never;

const request = () => requestExport(env, db, SCOPE, REC, 'u1');
const runnerRowOf = (id: string) => ({ ...mocks.rows.get(id)! }) as never;
const mp4 = () => new Uint8Array([0, 0, 0, 24]).buffer;

beforeEach(() => {
  mocks.rows.clear();
  mocks.provisioned = true;
  mocks.manifest = { player: { url: 'https://cdn.test/replay/r/player.abc.js', cssUrl: 'https://cdn.test/replay/r/player.def.css' } };
  mocks.dispatchQaRunnerJob.mockClear().mockResolvedValue(true);
  mocks.hasUnits.mockClear().mockResolvedValue(true);
  mocks.chargeUnits.mockClear().mockResolvedValue({ charged: true, source: 'free' });
  mocks.listChunkSeqs.mockClear().mockResolvedValue([3, 4]);
  put.mockClear();
});

describe('requestExport', () => {
  it('is unavailable — and free — when no runner is provisioned', async () => {
    mocks.provisioned = false;
    const dto = await request();
    expect(dto).toMatchObject({ status: 'unavailable', error: 'runner_unavailable', recordingId: REC, downloadUrl: null });
    expect(mocks.dispatchQaRunnerJob).not.toHaveBeenCalled();
    expect(mocks.hasUnits).not.toHaveBeenCalled();
    expect(mocks.chargeUnits).not.toHaveBeenCalled();
  });

  it('is unavailable when the CDN manifest names no player bundle', async () => {
    mocks.manifest = { latest: { version: '1', url: 'https://cdn.test/r.js', hash: 'x', builtAt: '' } };
    expect((await request()).status).toBe('unavailable');
    expect(mocks.dispatchQaRunnerJob).not.toHaveBeenCalled();
  });

  it('queues the render and dispatches ONE replay_export job with the stored chunks and the player', async () => {
    const dto = await request();
    expect(dto.status).toBe('queued');
    expect(mocks.dispatchQaRunnerJob).toHaveBeenCalledTimes(1);
    const job = mocks.dispatchQaRunnerJob.mock.calls[0]![1] as { kind: string; jobId: string; payload: Record<string, unknown> };
    expect(job.kind).toBe('replay_export');
    expect(job.jobId).toBe(dto.id);
    expect(job.payload).toMatchObject({
      exportId: dto.id,
      chunkUrls: [
        `https://api.test/api/replay/export-runner/${dto.id}/chunks/3`,
        `https://api.test/api/replay/export-runner/${dto.id}/chunks/4`,
      ],
      uploadUrl: `https://api.test/api/replay/export-runner/${dto.id}/video`,
      statusUrl: `https://api.test/api/replay/export-runner/${dto.id}`,
      playerUrl: 'https://cdn.test/replay/r/player.abc.js',
      playerCssUrl: 'https://cdn.test/replay/r/player.def.css',
      playerGlobal: 'BuilderforceReplayPlayer',
      viewport: { w: 1280, h: 720 },
      durationMs: 60_000,
    });
    // The token in the job authorises exactly this export.
    const row = await authorizeExportRunner(env, db, `Bearer ${job.payload.exportToken as string}`, dto.id);
    expect(row.id).toBe(dto.id);
    expect(mocks.chargeUnits).not.toHaveBeenCalled();
  });

  it('reuses a live export instead of rendering (and charging) twice', async () => {
    const first = await request();
    const second = await request();
    expect(second.id).toBe(first.id);
    expect(mocks.dispatchQaRunnerJob).toHaveBeenCalledTimes(1);
  });

  it('retires a stale queued export and renders again', async () => {
    const first = await request();
    mocks.rows.get(first.id)!.createdAt = new Date(Date.now() - 31 * 60_000);
    const second = await request();
    expect(second.id).not.toBe(first.id);
    expect(mocks.rows.get(first.id)).toMatchObject({ status: 'failed', error: 'timed_out' });
  });

  it('refuses up front when the workspace cannot pay for it', async () => {
    mocks.hasUnits.mockResolvedValue(false);
    expect(await request()).toMatchObject({ status: 'failed', error: 'insufficient_units' });
    expect(mocks.hasUnits).toHaveBeenCalledWith(env, db, 7, REPLAY_EXPORT_UNITS, expect.any(Date));
    expect(mocks.dispatchQaRunnerJob).not.toHaveBeenCalled();
  });

  it('fails honestly when the container refuses the job', async () => {
    mocks.dispatchQaRunnerJob.mockResolvedValue(false);
    expect(await request()).toMatchObject({ status: 'failed', error: 'dispatch_failed' });
  });
});

describe('runner callbacks', () => {
  it('moves queued → running → done, stores the file and charges 10 units ONCE across retries', async () => {
    const { id } = await request();
    expect((await runnerReport(db, runnerRowOf(id), { status: 'running' })).status).toBe('running');

    const stale = runnerRowOf(id); // a retried upload carrying the pre-delivery row
    const done = await runnerUpload(env, db, runnerRowOf(id), { contentType: 'video/mp4', length: null, body: mp4() });
    expect(done).toMatchObject({ status: 'done', format: 'mp4', downloadUrl: `/api/replay/exports/${id}/download?site=${SITE}` });
    expect(put).toHaveBeenCalledWith(`replay-exports/t7/${id}.mp4`, expect.any(ArrayBuffer), expect.objectContaining({
      httpMetadata: { contentType: 'video/mp4' },
    }));

    await runnerUpload(env, db, stale, { contentType: 'video/mp4', length: null, body: mp4() });
    await runnerUpload(env, db, runnerRowOf(id), { contentType: 'video/mp4', length: null, body: mp4() });

    expect(mocks.chargeUnits).toHaveBeenCalledTimes(1);
    expect(mocks.chargeUnits).toHaveBeenCalledWith(env, db, expect.objectContaining({
      tenantId: 7, siteId: SITE, recordingId: REC, units: REPLAY_EXPORT_UNITS, reference: `replay-export:${id}`,
    }));
  });

  it('keeps a WebM when the runner had no ffmpeg', async () => {
    const { id } = await request();
    const done = await runnerUpload(env, db, runnerRowOf(id), { contentType: 'video/webm', length: null, body: mp4() });
    expect(done.format).toBe('webm');
    expect(put).toHaveBeenCalledWith(`replay-exports/t7/${id}.webm`, expect.anything(), expect.anything());
  });

  it('charges nothing for a failed render, and ignores a report after a terminal status', async () => {
    const { id } = await request();
    expect(await runnerReport(db, runnerRowOf(id), { status: 'failed', error: 'player_timeout' }))
      .toMatchObject({ status: 'failed', error: 'player_timeout' });
    expect((await runnerReport(db, runnerRowOf(id), { status: 'running' })).status).toBe('failed');
    await expect(runnerUpload(env, db, runnerRowOf(id), { contentType: 'video/mp4', length: null, body: mp4() }))
      .rejects.toMatchObject({ name: 'ConflictError' });
    expect(mocks.chargeUnits).not.toHaveBeenCalled();
  });

  it('refuses a non-video upload', async () => {
    const { id } = await request();
    await expect(runnerUpload(env, db, runnerRowOf(id), { contentType: 'text/html', length: null, body: mp4() }))
      .rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('accepts only a token minted for that export', async () => {
    const a = await request();
    mocks.rows.get(a.id)!.status = 'done'; // let a second export of the recording be requested
    mocks.rows.get(a.id)!.createdAt = new Date(Date.now() - 8 * 24 * 3_600_000);
    const b = await request();
    const tokenForA = await mintExportToken(env, 7, a.id);
    await expect(authorizeExportRunner(env, db, `Bearer ${tokenForA}`, b.id)).rejects.toMatchObject({ name: 'UnauthorizedError' });
    await expect(authorizeExportRunner(env, db, undefined, a.id)).rejects.toMatchObject({ name: 'UnauthorizedError' });
    await expect(authorizeExportRunner(env, db, 'Bearer not-a-token', a.id)).rejects.toMatchObject({ name: 'UnauthorizedError' });
  });
});

describe('member reads', () => {
  it('reads the status inside the scope only', async () => {
    const { id } = await request();
    expect((await exportStatus(env, db, SCOPE, id)).status).toBe('queued');
    await expect(exportStatus(env, db, { tenantId: 7, siteId: OTHER_SITE }, id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(exportStatus(env, db, SCOPE, 'nope')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('downloads only a finished export', async () => {
    const { id } = await request();
    await expect(downloadExport(env, db, SCOPE, id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await runnerUpload(env, db, runnerRowOf(id), { contentType: 'video/mp4', length: null, body: mp4() });
    const file = await downloadExport(env, db, SCOPE, id);
    expect(file).toMatchObject({ contentType: 'video/mp4', size: 3, filename: `recording-${REC}.mp4` });
    expect(get).toHaveBeenCalledWith(`replay-exports/t7/${id}.mp4`);
  });
});
