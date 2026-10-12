import { describe, expect, it, vi, beforeEach } from 'vitest';

const TENANT = 7;
const SECRET = 'secret-token-xyz-never-leak';

const { importSpecFromBoard, SpecImportError, publicSpecImportResult } = vi.hoisted(() => {
  class SpecImportError extends Error {
    status: 400 | 404 | 502;
    constructor(message: string, status: 400 | 404 | 502) {
      super(message);
      this.name = 'SpecImportError';
      this.status = status;
    }
  }
  function publicSpecImportResult(
    spec: Record<string, unknown>,
    extra: { created: boolean; linkedTaskId: number | null },
  ): Record<string, unknown> {
    const fields = [
      'id', 'projectId', 'goal', 'status', 'kind', 'prd',
      'sourceProvider', 'sourceExternalId', 'sourceUrl',
      'createdAt', 'updatedAt',
    ] as const;
    const out: Record<string, unknown> = {};
    for (const f of fields) if (spec[f] !== undefined) out[f] = spec[f];
    out.created = extra.created;
    out.linkedTaskId = extra.linkedTaskId;
    return out;
  }
  return {
    importSpecFromBoard: vi.fn(),
    SpecImportError,
    publicSpecImportResult,
  };
});

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('tenantId', TENANT);
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  bumpTicketSearchVersion: vi.fn(async () => {}),
}));

vi.mock('../../application/prd/importSpec', () => ({
  importSpecFromBoard,
  SpecImportError,
  publicSpecImportResult,
}));

import { createSpecRoutes } from './specRoutes';

const post = (b: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
});

const SPEC = {
  id: 'spec-new',
  projectId: 11,
  goal: 'Ship import',
  status: 'draft',
  kind: 'feature',
  prd: 'Do the thing',
  sourceProvider: 'github',
  sourceExternalId: '42',
  sourceUrl: 'https://github.com/o/r/issues/42',
  accessToken: SECRET,
};

describe('POST /api/specs/import', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 201 on first import and strips token-shaped keys', async () => {
    importSpecFromBoard.mockResolvedValue({ spec: SPEC, created: true, linkedTaskId: null });
    const res = await createSpecRoutes({} as never).request('/import', post({
      projectId: 11,
      externalId: '42',
      provider: 'github',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: 'spec-new',
      goal: 'Ship import',
      sourceProvider: 'github',
      sourceExternalId: '42',
      created: true,
      linkedTaskId: null,
    });
    expect(body).not.toHaveProperty('accessToken');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('returns 200 on idempotent re-import', async () => {
    importSpecFromBoard.mockResolvedValue({ spec: SPEC, created: false, linkedTaskId: 99 });
    const res = await createSpecRoutes({} as never).request('/import', post({
      projectId: 11,
      externalId: '42',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.created).toBe(false);
    expect(body.linkedTaskId).toBe(99);
  });

  it('maps unknown-provider to 400', async () => {
    importSpecFromBoard.mockRejectedValue(new SpecImportError(
      'Provider "monday" is not supported for spec import (github, jira, linear)',
      400,
    ));
    const res = await createSpecRoutes({} as never).request('/import', post({
      projectId: 11,
      externalId: '42',
      provider: 'monday',
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Provider "monday" is not supported for spec import (github, jira, linear)',
    });
  });

  it('maps no-connection to 404', async () => {
    importSpecFromBoard.mockRejectedValue(new SpecImportError('No board connection on this project', 404));
    const res = await createSpecRoutes({} as never).request('/import', post({
      projectId: 11,
      externalId: '42',
    }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'No board connection on this project' });
  });

  it('requires projectId and externalId', async () => {
    const app = createSpecRoutes({} as never);
    expect((await app.request('/import', post({ externalId: '42' }))).status).toBe(400);
    expect((await app.request('/import', post({ projectId: 11 }))).status).toBe(400);
    expect(importSpecFromBoard).not.toHaveBeenCalled();
  });
});
