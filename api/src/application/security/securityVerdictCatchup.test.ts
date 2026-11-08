import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  live: vi.fn(async (..._a: unknown[]) => false), onGreen: vi.fn(() => true), ensure: vi.fn(), ci: vi.fn(), merge: vi.fn(async () => true), rows: [] as Array<Record<string, unknown>>,
}));
vi.mock('../repos/mergeBranchToBase', () => ({ cloudMergeOnGreenCi: h.onGreen }));
vi.mock('./ensurePrSecurityVerdict', () => ({ securityVerdictEnsuringScan: h.ensure, INLINE_STEP_MIN_REMAINING_MS: 30_000 }));
vi.mock('../repos/pollPrCiStatus', () => ({ pollPrCiHead: h.ci }));
vi.mock('../ci/mergeOnGreen', () => ({ mergeOnGreen: h.merge }));
vi.mock('../runtime/liveExecutionStatus', () => ({ taskHasLiveRun: h.live }));
vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { CATCHUP_MAX_PER_RUN, runSecurityVerdictCatchup } from './securityVerdictCatchup';

const SHA = 'a'.repeat(40);
const pr = (n: number) => ({ id: `pr-${n}`, tenantId: 1, taskId: n, branchName: `builderforce/task-${n}`, number: n, repoId: 'r', buildStatus: 'success', updatedAt: new Date() });
const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => h.rows }) }) }) }) } as never;
const budget = { canAfford: () => true };

beforeEach(() => {
  h.live.mockResolvedValue(false); h.onGreen.mockReturnValue(true); h.ensure.mockReset(); h.ci.mockReset(); h.merge.mockClear(); h.rows = [pr(1)];
});

describe('security-verdict-catchup', () => {
  it('does nothing at all unless the deployment merges on green CI', async () => {
    h.onGreen.mockReturnValue(false);
    expect(await runSecurityVerdictCatchup({} as never, db, budget)).toEqual({ considered: 0, merged: 0, stoppedForBudget: false });
    expect(h.ensure).not.toHaveBeenCalled();
  });

  it('scans a green PR whose head has no verdict (inline), then merges it in check mode when CI is green on that SAME head', async () => {
    h.ensure.mockResolvedValue({ allow: true, headSha: SHA });
    h.ci.mockResolvedValue({ headSha: SHA, green: true });
    const out = await runSecurityVerdictCatchup({} as never, db, budget);
    expect(h.ensure).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, 'pr-1', { mode: 'inline' });
    expect(h.merge).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'secret',
      expect.objectContaining({ taskId: 1, eventSha: SHA, branch: 'builderforce/task-1' }), 'check');
    expect(out).toMatchObject({ considered: 1, merged: 1 });
  });

  it('regression: Minor 6 - a PR whose task still has a live run is neither scanned nor merged', async () => {
    h.live.mockResolvedValue(true);
    const out = await runSecurityVerdictCatchup({} as never, db, budget);
    expect(h.ensure).not.toHaveBeenCalled();
    expect(h.merge).not.toHaveBeenCalled();
    expect(out).toMatchObject({ considered: 0, merged: 0 });
  });

  it('does not merge when the verdict still blocks', async () => {
    h.ensure.mockResolvedValue({ allow: false, reasons: [{ code: 'scan_failed', message: 'x' }], headSha: SHA });
    const out = await runSecurityVerdictCatchup({} as never, db, budget);
    expect(h.merge).not.toHaveBeenCalled();
    expect(out).toMatchObject({ considered: 1, merged: 0 });
  });

  it('does not merge when CI is green on a DIFFERENT head than the security-checked one', async () => {
    h.ensure.mockResolvedValue({ allow: true, headSha: SHA });
    h.ci.mockResolvedValue({ headSha: 'b'.repeat(40), green: true });
    await runSecurityVerdictCatchup({} as never, db, budget);
    expect(h.merge).not.toHaveBeenCalled();
  });

  it('is capped per run and stops when the budget no longer affords a full step', async () => {
    h.rows = Array.from({ length: 12 }, (_, i) => pr(i + 1));
    h.ensure.mockResolvedValue({ allow: false, reasons: [], headSha: SHA });
    expect((await runSecurityVerdictCatchup({} as never, db, budget)).considered).toBe(CATCHUP_MAX_PER_RUN);
    const out = await runSecurityVerdictCatchup({} as never, db, { canAfford: () => false });
    expect(out).toMatchObject({ considered: 0, stoppedForBudget: true });
  });
});
