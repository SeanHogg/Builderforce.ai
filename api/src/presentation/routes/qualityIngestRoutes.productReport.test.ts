import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const mocks = vi.hoisted(() => ({ ingestErrorEvents: vi.fn() }));
vi.mock('../../application/quality/ingestEngine', () => ({ ingestErrorEvents: mocks.ingestErrorEvents }));

import { createQualityIngestRoutes } from './qualityIngestRoutes';

function productProjectDb(rows = [{ id: 11, tenantId: 1 }]): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => rows }),
      }),
    }),
  } as unknown as Db;
}

describe('POST /product-report', () => {
  beforeEach(() => {
    mocks.ingestErrorEvents.mockReset();
    mocks.ingestErrorEvents.mockResolvedValue({ accepted: 1, rejected: 0, capExceeded: false });
  });

  it('accepts an anonymous report and fixes its destination to BuilderForce.AI', async () => {
    const app = createQualityIngestRoutes(productProjectDb());
    const response = await app.request('/product-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '401', message: 'Authorization failed', source: 'manual' }),
    }, {});

    expect(response.status).toBe(202);
    expect(mocks.ingestErrorEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: null, tenantId: 1, projectId: 11, defaultProjectId: null },
      [expect.objectContaining({ type: 'UserReportedError', message: '401 — Authorization failed' })],
    );
  });

  it('fails closed when the canonical product project cannot be resolved uniquely', async () => {
    const app = createQualityIngestRoutes(productProjectDb([]));
    const response = await app.request('/product-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Broken' }),
    }, {});

    expect(response.status).toBe(503);
    expect(mocks.ingestErrorEvents).not.toHaveBeenCalled();
  });
});
