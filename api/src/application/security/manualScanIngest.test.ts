import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ingest: vi.fn(async () => ({ inserted: 1, duplicates: 0, countsBySeverity: {} })) }));
vi.mock('./vulnerabilityFindings', () => ({ ingestScanFindings: h.ingest }));

import { ingestManualScanReport } from './manualScanIngest';

const scope = { tenantId: 1, segmentId: 'seg', scanId: 's1' };
const report = { format: 'normalized' as const, report: [] };
const dbWith = (row: Record<string, unknown> | null) =>
  ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }) }) as never;

beforeEach(() => h.ingest.mockClear());

describe('manager report upload (POST /vuln-scans/:scanId/findings)', () => {
  it.each([
    ['linked to a PR', { id: 's1', pullRequestId: 'pr', headSha: null, triggeredBy: 'Jane' }],
    ['keyed to a commit', { id: 's1', pullRequestId: null, headSha: 'abc', triggeredBy: 'Jane' }],
    ['triggered by an agent', { id: 's1', pullRequestId: null, headSha: null, triggeredBy: 'agent:coder' }],
    ['started by Run scan', { id: 's1', pullRequestId: null, headSha: null, triggeredBy: 'user:42' }],
  ])('REFUSES (403) a platform-recorded scan - %s - and writes nothing', async (_n, row) => {
    const out = await ingestManualScanReport(dbWith(row), {} as never, scope, report);
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it('accepts a report for a scan a person created by hand - and only passes format + report', async () => {
    const out = await ingestManualScanReport(dbWith({ id: 's1', pullRequestId: null, headSha: null, triggeredBy: 'Jane (pen test)' }), {} as never, scope, report);
    expect(out.ok).toBe(true);
    expect(h.ingest).toHaveBeenCalledWith(expect.anything(), expect.anything(), scope, { format: 'normalized', report: [] });
  });

  it('404s a scan that is not in this segment', async () => {
    expect(await ingestManualScanReport(dbWith(null), {} as never, scope, report)).toMatchObject({ ok: false, status: 404 });
  });
});
