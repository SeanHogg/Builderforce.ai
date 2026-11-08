import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  gate: vi.fn(), live: vi.fn(async (..._a: unknown[]) => false), merge: vi.fn(), markMerged: vi.fn(async () => null), close: vi.fn(async () => null), event: vi.fn(async () => undefined),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../security/ensurePrSecurityVerdict', () => ({ securityGateForTask: h.gate }));
vi.mock('../security/prSecurityGate', () => ({ describeSecurityBlock: () => 'held for security' }));
vi.mock('../runtime/cloudToolEvents', () => ({ recordCloudToolEvent: h.event }));
vi.mock('../repos/resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: vi.fn(async () => ({ repoId: 'r1' })) }));
vi.mock('../repos/resolveRepoCredential', () => ({
  resolveRepoCredential: vi.fn(async () => ({ repo: { provider: 'github', host: null, owner: 'acme', repo: 'api', defaultBranch: 'main' }, token: 't' })),
  isResolveError: () => false,
}));
vi.mock('../repos/mergeBranchToBase', () => ({ mergeBranchToBase: h.merge }));
vi.mock('../repos/commitFileAsPendingChange', () => ({ ticketBranchName: (id: number) => `builderforce/task-${id}` }));
vi.mock('../repos/recordPullRequestRow', () => ({ markPullRequestMergedByTask: h.markMerged }));
vi.mock('../manager/reviewGateAuthority', () => ({ closeTicketAutomatically: h.close }));
vi.mock('../runtime/liveExecutionStatus', () => ({ taskHasLiveRun: h.live }));

import { mergeOnGreen } from './mergeOnGreen';

const SHA = 'a'.repeat(40);
const ctx = { tenantId: 1, taskId: 7, execId: 42, branch: 'builderforce/task-7', eventSha: SHA };
const run = (mode: 'defer' | 'check') => mergeOnGreen({} as never, {} as never, 'secret', ctx, mode);

beforeEach(() => {
  h.live.mockResolvedValue(false); h.gate.mockReset(); h.merge.mockReset(); h.markMerged.mockClear(); h.close.mockClear(); h.event.mockClear();
  h.merge.mockResolvedValue({ ok: true, merged: true, sha: 'm1' });
});

describe('mergeOnGreen', () => {
  it('judges the PR at the commit CI passed on, and pins the merge to the head the gate verified', async () => {
    h.gate.mockResolvedValue({ allow: true, headSha: SHA });
    expect(await run('check')).toBe(true);
    expect(h.gate).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, 7, expect.objectContaining({ eventSha: SHA, mode: 'check' }));
    expect(h.merge).toHaveBeenCalledWith(expect.objectContaining({ head: 'builderforce/task-7', expectedHeadSha: SHA }));
    expect(h.markMerged).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('does not merge a blocked PR, and records why', async () => {
    h.gate.mockResolvedValue({ allow: false, reasons: [{ code: 'scan_missing', message: 'x' }], headSha: SHA });
    expect(await run('defer')).toBe(false);
    expect(h.merge).not.toHaveBeenCalled();
    expect(h.event).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toolName: 'merge_blocked_security' }));
  });

  it('only the webhook (defer) hands the gate an afterScan, and that callback re-runs the evaluation in CHECK mode', async () => {
    h.gate.mockResolvedValue({ allow: false, reasons: [], headSha: SHA });
    await run('check');
    expect(h.gate.mock.calls[0]![4].afterScan).toBeUndefined(); // check mode can never reschedule itself

    h.gate.mockClear();
    await run('defer');
    const afterScan = h.gate.mock.calls[0]![4].afterScan as () => Promise<void>;
    expect(typeof afterScan).toBe('function');
    h.gate.mockClear();
    h.gate.mockResolvedValue({ allow: true, headSha: SHA });
    await afterScan();
    expect(h.gate).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, 7, expect.objectContaining({ mode: 'check' }));
    expect(h.merge).toHaveBeenCalledOnce(); // the scheduled scan really does lead to the merge
  });

  it('regression: Minor 6 - never merges, or even asks the gate, while the task still has a live run', async () => {
    h.live.mockResolvedValue(true);
    h.gate.mockResolvedValue({ allow: true, headSha: SHA });
    expect(await run('check')).toBe(false);
    expect(h.gate).not.toHaveBeenCalled();
    expect(h.merge).not.toHaveBeenCalled();
  });

  it('does not merge a branch that is not the task\'s ticket branch', async () => {
    h.gate.mockResolvedValue({ allow: true, headSha: SHA });
    expect(await mergeOnGreen({} as never, {} as never, 's', { ...ctx, branch: 'main' }, 'check')).toBe(false);
    expect(h.merge).not.toHaveBeenCalled();
  });
});
