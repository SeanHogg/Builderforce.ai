import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const h = vi.hoisted(() => ({ ensure: vi.fn(), ci: vi.fn() }));
vi.mock('../security/ensurePrSecurityVerdict', () => ({
  securityVerdictEnsuringScan: h.ensure, INLINE_STEP_MIN_REMAINING_MS: 30_000,
}));
vi.mock('../security/prSecurityGate', () => ({
  describeSecurityBlock: (v: { reasons: Array<{ message: string }> }) => `held for security: ${v.reasons.map((r) => r.message).join('; ')}`,
}));
vi.mock('./pollPrCiStatus', () => ({ pollPrCiHead: h.ci }));

import { sweepSecurityGate } from './sweepSecurityGate';

const SHA = 'f'.repeat(40);
const NEWER = '9'.repeat(40);
const pr = { id: 'pr', number: 3, repoId: 'r', buildStatus: 'success', updatedAt: new Date() };
const gate = (budget: { canAfford: (ms: number) => boolean }, requireCi = false) =>
  sweepSecurityGate({} as never, {} as never, budget, 1, pr, requireCi);
beforeEach(() => { h.ensure.mockReset(); h.ci.mockReset(); });

describe('sweepSecurityGate', () => {
  it('runs the step inline only when the pass budget affords a model review (30s), else defers it', async () => {
    h.ensure.mockResolvedValue({ allow: true, headSha: SHA });
    await gate({ canAfford: () => true });
    expect(h.ensure).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 1, 'pr', { mode: 'inline' });
    await gate({ canAfford: () => false });
    expect(h.ensure).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 1, 'pr', { mode: 'defer' });
  });

  it('asks the budget about the full 30s, not a token amount', async () => {
    h.ensure.mockResolvedValue({ allow: true, headSha: SHA });
    const canAfford = vi.fn(() => false);
    await gate({ canAfford });
    expect(canAfford).toHaveBeenCalledWith(30_000);
  });

  it('an allow carries the head commit the merge must pin to; a block carries its reasons and a summary', async () => {
    h.ensure.mockResolvedValueOnce({ allow: true, headSha: SHA });
    expect(await gate({ canAfford: () => true })).toEqual({ allow: true, headSha: SHA });
    const reasons = [{ code: 'scan_failed', scanType: 'SCA', message: 'SCA scan failed' }];
    h.ensure.mockResolvedValueOnce({ allow: false, reasons, headSha: SHA });
    expect(await gate({ canAfford: () => true }))
      .toEqual({ allow: false, reasons, summary: 'held for security: SCA scan failed' });
  });
});

describe('under on_green the security pin must be the commit CI passed on', () => {
  beforeEach(() => h.ensure.mockResolvedValue({ allow: true, headSha: SHA }));

  it('merges when CI is green on exactly the security-checked head', async () => {
    h.ci.mockResolvedValue({ headSha: SHA.toUpperCase(), green: true });
    expect(await gate({ canAfford: () => true }, true)).toEqual({ allow: true, headSha: SHA });
  });

  it('DEFERS (no merge) when the security pin is on a newer head than the commit CI went green on', async () => {
    h.ci.mockResolvedValue({ headSha: NEWER, green: true });
    const out = await gate({ canAfford: () => true }, true);
    expect(out).toMatchObject({ allow: false });
    if (!out.allow) expect(out.reasons[0]).toMatchObject({ code: 'ci_not_on_head', detail: SHA.slice(0, 12) });
  });

  it('defers when CI is not green on the head, or cannot be read', async () => {
    h.ci.mockResolvedValue({ headSha: SHA, green: false });
    expect((await gate({ canAfford: () => true }, true)).allow).toBe(false);
    h.ci.mockResolvedValue(null);
    expect((await gate({ canAfford: () => true }, true)).allow).toBe(false);
  });

  it('is not consulted under a policy that does not wait for CI', async () => {
    expect(await gate({ canAfford: () => true }, false)).toEqual({ allow: true, headSha: SHA });
    expect(h.ci).not.toHaveBeenCalled();
  });
});

describe('the merge sweep pins the merge and treats a moved head as a non-failure', () => {
  const src = readFileSync(fileURLToPath(new URL('./prMergeSweep.ts', import.meta.url).href), 'utf8');

  it('passes the verified head to the merge call', () => {
    expect(src).toMatch(/expectedHeadSha:\s*security\.headSha/);
  });

  it('skips a head_moved result BEFORE it is journalled as a failure or a conflict, so it counts against no ceiling', () => {
    const moved = src.indexOf("result.code === 'head_moved') continue;");
    expect(moved).toBeGreaterThan(-1);
    expect(moved).toBeLessThan(src.indexOf('actionType: MERGE_FAILED_ACTION', moved));
    expect(moved).toBeLessThan(src.indexOf('PR_CONFLICT_ACTION', moved));
  });

  it('carries no gate logic of its own - one call to the gate module', () => {
    expect(src).toMatch(/sweepSecurityGate\(db, env, budget, tenantId, pr, policy\.prMergePolicy === 'on_green'\)/);
    expect(src).not.toMatch(/securityVerdictEnsuringScan|evaluateSecurityGate|describeSecurityBlock/);
  });
});
