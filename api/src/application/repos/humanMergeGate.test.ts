import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('../security/ensurePrSecurityVerdict', () => ({ securityVerdictEnsuringScan: h.ensure }));
vi.mock('../security/prSecurityGate', () => ({
  describeSecurityBlock: (v: { reasons: Array<{ message: string }> }) => `held for security: ${v.reasons.map((r) => r.message).join('; ')}`,
}));

import { gateHumanMerge } from './humanMergeGate';

const SHA = 'a'.repeat(40);
beforeEach(() => h.ensure.mockReset());

describe('a person\'s Approve & Merge goes through the same security gate', () => {
  it('is BLOCKED (409 with the gate\'s reasons) when the gate holds the PR and no manager overrode it', async () => {
    const reasons = [
      { code: 'scan_failed', scanType: 'SAST', message: 'SAST scan failed' },
      { code: 'open_blocker', severity: 'HIGH', source: 'scan', detail: 'eval (a.ts)', message: 'HIGH scan finding: eval (a.ts)' },
    ];
    h.ensure.mockResolvedValue({ allow: false, reasons, headSha: SHA });
    const out = await gateHumanMerge({} as never, {} as never, 1, 'pr-1');
    // the reasons travel as STRUCTURED data (the UI words them); the English `error` is for logs / API clients
    expect(out).toMatchObject({ ok: false, status: 409, body: { code: 'security_gate', details: { reasons, headSha: SHA } } });
    if (!out.ok) expect(out.body.error).toMatch(/SAST scan failed/);
  });

  it('is ALLOWED once a manager has recorded the override for this commit, and pins the merge to it', async () => {
    h.ensure.mockResolvedValue({ allow: true, overridden: true, headSha: SHA });
    expect(await gateHumanMerge({} as never, {} as never, 1, 'pr-1')).toEqual({ ok: true, headSha: SHA });
  });

  it('asks for a scheduled (not inline) scan, so the request does not wait on a model review', async () => {
    h.ensure.mockResolvedValue({ allow: true, headSha: SHA });
    await gateHumanMerge({} as never, {} as never, 1, 'pr-1');
    expect(h.ensure).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, 'pr-1', { mode: 'defer' });
  });
});
