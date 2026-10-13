/**
 * `/api/replay` export routes — members go through the Insights gate and the D17
 * `?site=` scope; the runner callbacks take ONLY the export's capability token (no
 * member auth). The export use cases and the site lookup are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError, UnauthorizedError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EXP = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const mocks = vi.hoisted(() => ({
  entitled: true,
  memberAuthCalls: 0,
  requestExport: vi.fn(),
  exportStatus: vi.fn(),
  downloadExport: vi.fn(),
  authorizeExportRunner: vi.fn(),
  runnerChunk: vi.fn(),
  runnerReport: vi.fn(),
  runnerUpload: vi.fn(),
  getSiteForTenant: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    mocks.memberAuthCalls += 1;
    c.set('tenantId', Number(c.req.header('x-tenant') ?? 7));
    c.set('userId', 'u1');
    c.set('db', {} as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/tenant/featureEntitlements', () => ({
  resolveFeatureEntitlement: vi.fn(async (_env: unknown, _tenantId: number, _userId: unknown, feature: string) => ({
    entitled: mocks.entitled,
    reason: mocks.entitled ? 'capability' : 'not_entitled',
    feature,
    label: 'Insights',
    currentPlan: 'free',
    requiredPlan: 'teams',
    capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/replay/replayVideoExport', () => ({
  requestExport: mocks.requestExport,
  exportStatus: mocks.exportStatus,
  downloadExport: mocks.downloadExport,
  authorizeExportRunner: mocks.authorizeExportRunner,
  runnerChunk: mocks.runnerChunk,
  runnerReport: mocks.runnerReport,
  runnerUpload: mocks.runnerUpload,
}));
vi.mock('../../application/replay/replaySites', () => ({ getSiteForTenant: mocks.getSiteForTenant }));
vi.mock('../../application/shared/dbHandle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/shared/dbHandle')>()),
  // The runner routes carry no member session, so nothing publishes a db on the context.
  requestDb: () => ({}),
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayExportRoutes } from './replayExportRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { tenant?: number } = {}) {
  const router = createReplayExportRoutes();
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.tenant) headers.set('x-tenant', String(init.tenant));
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

const queued = { id: EXP, recordingId: REC, status: 'queued', format: null, downloadUrl: null, error: null, createdAt: '2026-10-12T00:00:00.000Z' };

beforeEach(() => {
  mocks.entitled = true;
  mocks.memberAuthCalls = 0;
  for (const fn of [mocks.requestExport, mocks.exportStatus, mocks.downloadExport, mocks.authorizeExportRunner,
    mocks.runnerChunk, mocks.runnerReport, mocks.runnerUpload]) fn.mockReset();
  mocks.getSiteForTenant.mockReset().mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, siteId: string) => {
    if (tenantId !== 7 || siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
    return { id: siteId, tenantId };
  });
});

describe('member routes', () => {
  it('requests an export with the caller’s scope and answers 202 while queued', async () => {
    mocks.requestExport.mockResolvedValue(queued);
    const res = await call(`/recordings/${REC}/export?site=${OWN_SITE}`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(mocks.requestExport).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, REC, 'u1');
  });

  it('answers 200 for an honest unavailable', async () => {
    mocks.requestExport.mockResolvedValue({ ...queued, status: 'unavailable', error: 'runner_unavailable' });
    const res = await call(`/recordings/${REC}/export?site=${OWN_SITE}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('unavailable');
  });

  it('answers 403 for another workspace’s site', async () => {
    const res = await call(`/exports/${EXP}?site=${OTHER_SITE}`);
    expect(res.status).toBe(403);
    expect(mocks.exportStatus).not.toHaveBeenCalled();
  });

  it('answers 403 without Insights', async () => {
    mocks.entitled = false;
    const res = await call(`/recordings/${REC}/export?site=${OWN_SITE}`, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(mocks.requestExport).not.toHaveBeenCalled();
  });

  it('streams a finished file as an attachment', async () => {
    mocks.downloadExport.mockResolvedValue({
      body: new Response(new Uint8Array([1, 2, 3])).body, contentType: 'video/mp4', size: 3, filename: `recording-${REC}.mp4`,
    });
    const res = await call(`/exports/${EXP}/download?site=${OWN_SITE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="recording-${REC}.mp4"`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('runner routes', () => {
  it('use the export token, never member auth', async () => {
    const row = { id: EXP, tenantId: 7 };
    mocks.authorizeExportRunner.mockResolvedValue(row);
    mocks.runnerReport.mockResolvedValue({ ...queued, status: 'running' });
    const res = await call(`/export-runner/${EXP}`, {
      method: 'PATCH', headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'running' }),
    });
    expect(res.status).toBe(200);
    expect(mocks.authorizeExportRunner).toHaveBeenCalledWith({}, {}, 'Bearer tok', EXP);
    expect(mocks.runnerReport).toHaveBeenCalledWith({}, row, { status: 'running', error: null });
    expect(mocks.memberAuthCalls).toBe(0);
  });

  it('answer 401 for a bad token and do nothing', async () => {
    mocks.authorizeExportRunner.mockRejectedValue(new UnauthorizedError('Invalid or expired export token'));
    const res = await call(`/export-runner/${EXP}/chunks/0`);
    expect(res.status).toBe(401);
    expect(mocks.runnerChunk).not.toHaveBeenCalled();
  });

  it('refuse an unknown status', async () => {
    mocks.authorizeExportRunner.mockResolvedValue({ id: EXP, tenantId: 7 });
    const res = await call(`/export-runner/${EXP}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.runnerReport).not.toHaveBeenCalled();
  });

  it('hand the upload body and its declared type to the use case', async () => {
    mocks.authorizeExportRunner.mockResolvedValue({ id: EXP, tenantId: 7 });
    mocks.runnerUpload.mockResolvedValue({ ...queued, status: 'done', format: 'mp4' });
    const res = await call(`/export-runner/${EXP}/video`, {
      method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': '4' }, body: new Uint8Array([0, 0, 0, 24]),
    });
    expect(res.status).toBe(200);
    expect(mocks.runnerUpload).toHaveBeenCalledWith({}, {}, { id: EXP, tenantId: 7 }, expect.objectContaining({ contentType: 'video/mp4', body: expect.any(ReadableStream) }));
  });
});
