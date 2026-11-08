import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listBranchDiff: vi.fn(),
  listRepoFiles: vi.fn(),
  readRepoFile: vi.fn(),
  ingest: vi.fn(async () => ({ inserted: 0, duplicates: 0, countsBySeverity: {} })),
  endPrScan: vi.fn(async () => undefined),
  queryOsv: vi.fn(),
}));

vi.mock('../repos/readRepoContents', () => ({
  listBranchDiff: h.listBranchDiff, listRepoFiles: h.listRepoFiles, readRepoFile: h.readRepoFile,
}));
vi.mock('./vulnerabilityFindings', () => ({ ingestScanFindings: h.ingest }));
vi.mock('./prScanStore', () => ({
  ensurePrScan: vi.fn(async (_e: unknown, _d: unknown, _a: unknown, _s: unknown, type: string) => ({ id: `scan-${type}`, segmentId: 'seg', reused: false })),
  endPrScan: h.endPrScan,
}));
vi.mock('./osvScaScan', async (orig) => ({ ...(await orig<typeof import('./osvScaScan')>()), queryOsv: h.queryOsv }));

import { collectChangedFiles, runPullRequestScan } from './prSecurityScan';

const SHA = 'c'.repeat(40);
const read = { provider: 'github', host: null, owner: 'acme', repo: 'api', token: 't', ref: 'builderforce/task-7' };
const scope = {
  tenantId: 1, segmentId: 'seg', pullRequestId: 'pr-1', executionId: null, repoRef: 'acme/api', ref: read.ref, triggeredBy: 'system', headSha: SHA,
};
const actor = { type: 'system' as const, ref: null, name: 'System' };

const diff = (paths: string[]) => ({ ok: true, truncated: false, files: paths.map((path) => ({ path, status: 'modified' })) });
const ok = (path: string, content = 'const a = 1;') => ({ ok: true, path, content, truncated: false });

beforeEach(() => { Object.values(h).forEach((m) => 'mockReset' in m && (m as ReturnType<typeof vi.fn>).mockReset()); h.ingest.mockResolvedValue({ inserted: 0, duplicates: 0, countsBySeverity: {} }); h.queryOsv.mockResolvedValue({ ok: true, findings: [], vulnerablePackages: 0, truncated: false }); });

describe('the scan reads at the verified commit', () => {
  it('lists the diff and reads every file at head.sha - never at the branch name', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['src/a.ts', 'package.json']));
    h.readRepoFile.mockImplementation(async (_ctx: unknown, p: string) => ok(p, p === 'package.json' ? '{"dependencies":{}}' : 'x'));
    await collectChangedFiles(read, 'main', SHA);
    expect(h.listBranchDiff).toHaveBeenCalledWith(expect.objectContaining({ ref: SHA }), 'main', SHA);
    const sourceReads = h.readRepoFile.mock.calls.filter(([, p]) => p === 'src/a.ts' || p === 'package.json');
    expect(sourceReads.length).toBeGreaterThan(0);
    for (const [ctx] of sourceReads) expect((ctx as { ref: string }).ref).toBe(SHA);
  });
});

describe('a read failure is never a clean scan', () => {
  it('marks the scan truncated with the reason and does NOT replace the earlier open findings', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['src/a.ts', 'src/b.ts']));
    h.readRepoFile.mockImplementation(async (_c: unknown, p: string) => (p === 'src/b.ts' ? { ok: false, reason: 'GitHub 403: rate limited' } : ok(p)));
    const collected = await collectChangedFiles(read, 'main', SHA);
    expect(collected).toMatchObject({ ok: true, truncated: true });
    if (collected.ok) expect(collected.readFailures).toEqual(['src/b.ts: GitHub 403: rate limited']);

    const outcome = await runPullRequestScan({} as never, {} as never, actor, scope, collected);
    expect(outcome.scans.find((s) => s.scanType === 'SECRET')?.status).toBe('completed');
    const secretIngest = h.ingest.mock.calls.find((c) => (c as unknown as [unknown, unknown, { scanId: string }])[2].scanId === 'scan-SECRET');
    const input = (secretIngest as unknown as [unknown, unknown, unknown, Record<string, unknown>])[3];
    expect(input).toMatchObject({ truncated: true, replaceOpen: false });
    expect(String(input.notes)).toMatch(/rate limited/);
  });

  it('a file cut at the read cap counts as a failure too', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['src/a.ts']));
    h.readRepoFile.mockResolvedValue({ ok: true, path: 'src/a.ts', content: 'x', truncated: true });
    const collected = await collectChangedFiles(read, 'main', SHA);
    expect(collected).toMatchObject({ ok: true, truncated: true });
  });

  it('when NOTHING could be read the scans FAIL - they do not complete clean', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['src/a.ts', 'src/b.ts']));
    h.readRepoFile.mockResolvedValue({ ok: false, reason: 'timeout' });
    const collected = await collectChangedFiles(read, 'main', SHA);
    const outcome = await runPullRequestScan({} as never, {} as never, actor, scope, collected);
    expect(outcome.scans.find((s) => s.scanType === 'SECRET')?.status).toBe('failed');
    expect(outcome.scans.find((s) => s.scanType === 'SAST')?.status).toBe('failed');
    expect(h.ingest).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ scanId: 'scan-SECRET' }), expect.anything());
  });

  it('SCA: a manifest that was listed but could not be read FAILS the scan, it is not "no manifest changed"', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['package.json']));
    h.readRepoFile.mockResolvedValue({ ok: false, reason: 'HTTP 500' });
    const collected = await collectChangedFiles(read, 'main', SHA);
    const outcome = await runPullRequestScan({} as never, {} as never, actor, scope, collected);
    expect(outcome.scans.find((s) => s.scanType === 'SCA')?.status).toBe('failed');
    const notes = h.endPrScan.mock.calls.map((c) => String((c as unknown[])[3] ?? ''));
    expect(notes.join('|')).not.toMatch(/No dependency manifest changed/);
  });

  it('SCA with no manifest listed is honestly complete', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['src/a.ts']));
    h.readRepoFile.mockImplementation(async (_c: unknown, p: string) => ok(p));
    const collected = await collectChangedFiles(read, 'main', SHA);
    const outcome = await runPullRequestScan({} as never, {} as never, actor, scope, collected);
    expect(outcome.scans.find((s) => s.scanType === 'SCA')?.status).toBe('completed');
  });

  it('a PR touching only vendor/x.min.js never gets an allow: SECRET reads it, SAST is recorded truncated for the excluded executable', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['vendor/x.min.js']));
    h.readRepoFile.mockImplementation(async (_c: unknown, p: string) => ok(p, 'var k="AKIAABCDEFGHIJKLMNOP";'));
    const collected = await collectChangedFiles(read, 'main', SHA);
    expect(collected).toMatchObject({ ok: true, excludedExecutables: ['vendor/x.min.js'] });
    // the SECRET scan reads EVERY changed file, minified and vendored included
    if (collected.ok) expect(collected.files.map((f) => f.path)).toEqual(['vendor/x.min.js']);

    await runPullRequestScan({} as never, {} as never, actor, scope, collected);
    const byScan = (id: string) => (h.ingest.mock.calls.find((c) => (c as unknown as [unknown, unknown, { scanId: string }])[2].scanId === id) as unknown as [unknown, unknown, unknown, { report: Array<{ ruleId: string }>; truncated: boolean; replaceOpen: boolean; notes: string }])[3];
    // the secret hiding in the bundle is FOUND...
    expect(byScan('scan-SECRET').report.map((f) => f.ruleId)).toContain('secret.aws-access-key');
    expect(byScan('scan-SECRET').truncated).toBe(false);
    // ...and the SAST scan, which cannot read the bundle, is incomplete: the gate blocks it, an override is the way through.
    expect(byScan('scan-SAST')).toMatchObject({ truncated: true, replaceOpen: false });
    expect(byScan('scan-SAST').notes).toMatch(/Excluded executable path: vendor\/x\.min\.js/);
  });

  it('binary assets and lockfiles stay excluded quietly (not executable, not truncating)', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['logo.png', 'package-lock.json']));
    h.readRepoFile.mockImplementation(async (_c: unknown, p: string) => ok(p, '{}'));
    const collected = await collectChangedFiles(read, 'main', SHA);
    expect(collected).toMatchObject({ ok: true, excludedExecutables: [], sourceAttempted: 0 });
  });

  it('a complete scan may replace the earlier open findings', async () => {
    h.listBranchDiff.mockResolvedValue(diff(['src/a.ts']));
    h.readRepoFile.mockImplementation(async (_c: unknown, p: string) => ok(p));
    const collected = await collectChangedFiles(read, 'main', SHA);
    await runPullRequestScan({} as never, {} as never, actor, scope, collected);
    const secretIngest = h.ingest.mock.calls.find((c) => (c as unknown as [unknown, unknown, { scanId: string }])[2].scanId === 'scan-SECRET');
    expect((secretIngest as unknown as [unknown, unknown, unknown, Record<string, unknown>])[3]).toMatchObject({ replaceOpen: true, truncated: false });
  });
});
