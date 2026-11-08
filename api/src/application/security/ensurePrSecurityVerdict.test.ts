import { describe, expect, it } from 'vitest';

// The module under test imports the step (and through it the provider clients); only the PURE
// scheduling decision is exercised here, so the heavy imports are stubbed.
import { vi } from 'vitest';
vi.mock('./pullRequestSecurityStep', () => ({ runPullRequestSecurityStep: vi.fn() }));
vi.mock('./prSecurityGate', () => ({ loadGateInputs: vi.fn(), resolvePullRequestHead: vi.fn(), securityGateAtHead: vi.fn() }));
vi.mock('../repos/resolveRepoCredential', () => ({ resolveRepoCredential: vi.fn(), isResolveError: vi.fn() }));
vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: vi.fn() }));

const deferred = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[], available: true }));
vi.mock('../shared/requestScope', () => ({
  deferPastResponse: (p: Promise<unknown>) => { if (deferred.available) deferred.tasks.push(p); return deferred.available; },
}));

import { needsRescan, RESCAN_AFTER_MS, RUNNING_STALE_AFTER_MS, securityVerdictEnsuringScan } from './ensurePrSecurityVerdict';
import { REQUIRED_SCAN_TYPES, type GateScanRow } from './securityMergeGate';
import { loadGateInputs, resolvePullRequestHead, securityGateAtHead } from './prSecurityGate';
import { runPullRequestSecurityStep } from './pullRequestSecurityStep';

const NOW = new Date('2026-11-08T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const row = (scanType: string, over: Partial<GateScanRow> = {}): GateScanRow =>
  ({ scanType, status: 'completed', truncated: false, headSha: 'h', segmentId: 's', updatedAt: ago(1000), ...over });
const all = (over: Partial<GateScanRow> = {}) => REQUIRED_SCAN_TYPES.map((t) => row(t, over));

describe('needsRescan - when the merge paths scan a head commit themselves', () => {
  it('scans a head with no rows (a push that did not come through a cloud run)', () => {
    expect(needsRescan([], NOW)).toBe(true);
  });

  it('does not rescan when all four completed - even truncated ones (the same cap would apply)', () => {
    expect(needsRescan(all(), NOW)).toBe(false);
    expect(needsRescan(all({ truncated: true }), NOW)).toBe(false);
  });

  it('leaves a FRESH running scan alone (someone is on it) but rescans a crashed one after 5 minutes', () => {
    expect(needsRescan([...all().slice(1), row('SECRET', { status: 'running', updatedAt: ago(1000) })], NOW)).toBe(false);
    expect(needsRescan([...all().slice(1), row('SECRET', { status: 'running', updatedAt: ago(RUNNING_STALE_AFTER_MS - 1000) })], NOW)).toBe(false);
    expect(needsRescan([...all().slice(1), row('SECRET', { status: 'running', updatedAt: ago(RUNNING_STALE_AFTER_MS) })], NOW)).toBe(true);
  });

  it('retries a failed or skipped scan only after the window, so a broken scanner costs one try per window', () => {
    const failed = (age: number) => [...all().slice(1), row('SECRET', { status: 'failed', updatedAt: ago(age) })];
    expect(needsRescan(failed(60_000), NOW)).toBe(false);
    expect(needsRescan(failed(RESCAN_AFTER_MS), NOW)).toBe(true);
  });
});

describe('securityVerdictEnsuringScan - where a missing scan runs', () => {
  const block = {
    allow: false as const,
    reasons: [{ code: 'scan_missing' as const, scanType: 'SECRET', message: 'SECRET scan has not run for this commit' }],
  };

  function arrange() {
    deferred.tasks.length = 0;
    deferred.available = true;
    vi.mocked(resolvePullRequestHead).mockResolvedValue({ ok: true, sha: 'h'.padEnd(40, '0') });
    vi.mocked(loadGateInputs).mockResolvedValue({ currentHeadSha: 'h', scans: [], findings: [], overrideShas: [] });
    vi.mocked(securityGateAtHead).mockResolvedValue(block);
    vi.mocked(runPullRequestSecurityStep).mockReset();
    // the PR row lookup inside the module returns nothing, so the step is never reached through it;
    // what is asserted is WHETHER a deferral was scheduled and that the verdict stays a block.
  }
  const fakeDb = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as never;

  it('the CI webhook (defer) never runs the step inline: it schedules it past the response and blocks', async () => {
    arrange();
    const out = await securityVerdictEnsuringScan(fakeDb, {} as never, 1, 'pr-1', { mode: 'defer' });
    expect(runPullRequestSecurityStep).not.toHaveBeenCalled();
    expect(deferred.tasks).toHaveLength(1);
    expect(out.allow).toBe(false);
    if (!out.allow) expect(out.reasons.map((r) => r.code)).toEqual(['scan_missing', 'scan_scheduled']);
    expect(out.headSha).toBe('h'.padEnd(40, '0'));
  });

  it('when the deferred scan finishes it calls afterScan, so the merge really is attempted then', async () => {
    arrange();
    const afterScan = vi.fn(async () => undefined);
    await securityVerdictEnsuringScan(fakeDb, {} as never, 1, 'pr-1', { mode: 'defer', afterScan });
    expect(afterScan).not.toHaveBeenCalled(); // not before the response
    await Promise.all(deferred.tasks);
    expect(afterScan).toHaveBeenCalledOnce();
  });

  it("'check' only judges what is recorded: it never schedules, so afterScan cannot reschedule itself", async () => {
    arrange();
    const out = await securityVerdictEnsuringScan(fakeDb, {} as never, 1, 'pr-1', { mode: 'check' });
    expect(deferred.tasks).toHaveLength(0);
    expect(runPullRequestSecurityStep).not.toHaveBeenCalled();
    expect(out.allow).toBe(false);
  });

  it('with no invocation to defer to, nothing is scheduled and the block says the sweep will scan it', async () => {
    arrange();
    deferred.available = false;
    const out = await securityVerdictEnsuringScan(fakeDb, {} as never, 1, 'pr-1', { mode: 'defer' });
    expect(deferred.tasks).toHaveLength(0);
    expect(out.allow).toBe(false);
    if (!out.allow) {
      expect(out.reasons.map((r) => r.code)).toEqual(['scan_missing', 'scan_unscheduled']);
      expect(out.reasons.map((r) => r.message).join('|')).toMatch(/next merge sweep/);
    }
  });

  it('a clean verdict is returned pinned to the head commit, with nothing scheduled', async () => {
    arrange();
    vi.mocked(securityGateAtHead).mockResolvedValue({ allow: true });
    const out = await securityVerdictEnsuringScan(fakeDb, {} as never, 1, 'pr-1', { mode: 'defer' });
    expect(out).toEqual({ allow: true, headSha: 'h'.padEnd(40, '0') });
    expect(deferred.tasks).toHaveLength(0);
  });
});
