import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  kv: new Map<string, unknown>(),
}));

vi.mock('./prReconciliationService', () => ({
  PR_RECONCILIATION_POLICY_VERSION: 4,
  runPrTicketReconciliation: mocks.run,
}));
vi.mock('./githubCredentialCooldown', () => ({
  activeGithubCooldown: async () => null,
  githubCooldownFor: () => null,
  recordGithubCooldown: vi.fn(),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => mocks.kv.get(key) ?? null,
  setCached: async (_env: unknown, key: string, value: unknown) => { mocks.kv.set(key, value); },
}));

const { PR_RECONCILIATION_INTERVAL_MS, prReconciliationStampsKey, prReconciliationLastCheckedAt, runPrReconciliationSweep } =
  await import('./runPrReconciliationSweep');

const source = readFileSync(fileURLToPath(new URL('./runPrReconciliationSweep.ts', import.meta.url).href), 'utf8');
const ENV = {} as Env;
/** The ownership probe: one select…from…where…limit that finds the repo or not. */
const ownerDb = (owned: boolean) => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => (owned ? [{ id: 'a' }] : []) }) }) }),
}) as never;
const repo = (id: string, lastRunAt: Date | null = null) => ({ id, tenantId: 1, credentialId: 'cred-1', lastRunAt });

/** Fake Db: the candidate select resolves to `rows`. No write method exists, so any write throws. */
function fakeDb(rows: unknown[]) {
  return {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => rows }) }) }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kv.clear();
  mocks.run.mockResolvedValue({ runId: null, status: 'completed', summary: { total: 0 }, errors: 0 });
});

describe('scheduled PR reconciliation — idle-silent cadence', () => {
  it('runs a due repo with on_change persistence and stamps the check in KV, not Postgres', async () => {
    const r = await runPrReconciliationSweep(ENV, fakeDb([repo('a')]));
    expect(r.completed).toBe(1);
    expect(mocks.run).toHaveBeenCalledWith(ENV, expect.anything(), expect.objectContaining({
      repoId: 'a', mode: 'apply', autoApplyCloseCandidates: true, persist: 'on_change',
    }));
    expect(Object.keys(mocks.kv.get(prReconciliationStampsKey()) as object)).toEqual(['a']);
  });

  it('skips a repo checked inside the interval (KV stamp), even with no recorded run', async () => {
    mocks.kv.set(prReconciliationStampsKey(), { a: Date.now() - 60_000 });
    const r = await runPrReconciliationSweep(ENV, fakeDb([repo('a')]));
    expect(r.due).toBe(0);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('falls back to the last recorded current-policy run when KV has no stamp', async () => {
    const r = await runPrReconciliationSweep(ENV, fakeDb([repo('a', new Date())]));
    expect(r.due).toBe(0);
  });

  it('a policy bump uses a fresh ledger, so an old-policy stamp cannot postpone rollout', () => {
    expect(prReconciliationStampsKey(5)).not.toBe(prReconciliationStampsKey(4));
  });

  it('serves "last checked" from the KV stamp when newer than the last recorded run', async () => {
    const stamp = Date.now() - 5 * 60_000;
    mocks.kv.set(prReconciliationStampsKey(), { a: stamp });
    expect(await prReconciliationLastCheckedAt(ENV, ownerDb(true), 7, 'a', new Date(stamp - 3_600_000))).toBe(stamp);
    expect(await prReconciliationLastCheckedAt(ENV, ownerDb(true), 7, 'b', null)).toBeNull();
  });

  it("answers nothing for a repo the tenant does not own, even with a KV stamp", async () => {
    mocks.kv.set(prReconciliationStampsKey(), { a: Date.now() });
    expect(await prReconciliationLastCheckedAt(ENV, ownerDb(false), 7, 'a', null)).toBeNull();
  });
});

describe('scheduled PR reconciliation policy wiring', () => {
  it('runs audited apply mode with only the internal close-candidate policy enabled', () => {
    expect(source).toContain("mode: 'apply'");
    expect(source).toContain('autoApplyCloseCandidates: true');
  });

  it('only a current-policy apply run counts as the fallback cadence', () => {
    expect(source).toContain("previous.mode = 'apply'");
    expect(source).toContain("previous.summary ->> 'policyVersion'");
    expect(source).toContain('PR_RECONCILIATION_POLICY_VERSION');
  });

  it('reconciles each repo on a real interval — longer than a tick, far short of a day', () => {
    expect(PR_RECONCILIATION_INTERVAL_MS).toBeGreaterThanOrEqual(30 * 60 * 1_000);
    expect(PR_RECONCILIATION_INTERVAL_MS).toBeLessThan(23 * 60 * 60 * 1_000);
    expect(source).toContain('intervalMs: PR_RECONCILIATION_INTERVAL_MS');
  });

  it('backs off repeated GitHub authorization failures instead of retrying every cron tick', () => {
    expect(source).toContain("failure.details ->> 'status' = '403'");
    expect(source).toContain('6 * 60 * 60 * 1_000');
  });
});

describe('scheduled PR reconciliation GitHub throttle back-off', () => {
  it('skips a credential while GitHub has it cooled down, via the shared cooldown helper', () => {
    expect(source).toContain('activeGithubCooldown(env, credentialKey)');
    expect(source).toContain('recordGithubCooldown(env, credentialKey');
  });

  it('reports a refused credential once as a warning rather than an error every tick', () => {
    const catchBlock = source.slice(source.indexOf('githubCooldownFor(error)'));
    const cooldownBranch = catchBlock.slice(0, catchBlock.indexOf('continue;'));
    expect(cooldownBranch).toContain("level: 'warning'");
    expect(cooldownBranch).toContain('recordGithubCooldown(');
  });
});
