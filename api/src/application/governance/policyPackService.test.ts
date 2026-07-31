/**
 * policyPackService — resolver + cache-invalidation coverage.
 *
 * The point of the policy-pack store is that an authored gate reaches
 * `evaluatePolicyGate` at the engine's tool seam. These tests pin the two things
 * that can silently break that: the projection onto the exact wire shape, and the
 * read-through cache (which, if never invalidated, would serve a stale posture
 * after an operator edits a pack).
 */
import { describe, expect, it } from 'vitest';
import { evaluatePolicyGate } from '@builderforce/agent-tools';
import {
  invalidatePolicyCache,
  loadPolicyGates,
  resolvePolicyGates,
  isPolicyGateEffect,
} from './policyPackService';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

type GateRow = {
  gateKey: string;
  tool: string | null;
  effect: string;
  directive: string | null;
  reason: string | null;
};

// No AUTH_CACHE_KV → the L2 layer is absent and only the L1 Map engages, which is
// exactly what we want to observe (test/setup.ts clears it before every test).
const env = {} as Env;

/** db mock for the resolver's single joined query; counts loader invocations. */
function makeDb(rows: GateRow[]) {
  const calls = { count: 0 };
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: async () => {
              calls.count += 1;
              return rows;
            },
          }),
        }),
      }),
    }),
  } as unknown as Db;
  return { db, calls };
}

describe('isPolicyGateEffect', () => {
  it('accepts exactly the three PolicyGate effects', () => {
    expect(isPolicyGateEffect('block')).toBe(true);
    expect(isPolicyGateEffect('require-approval')).toBe(true);
    expect(isPolicyGateEffect('inject-directive')).toBe(true);
    expect(isPolicyGateEffect('allow')).toBe(false);
    expect(isPolicyGateEffect(undefined)).toBe(false);
  });
});

describe('loadPolicyGates', () => {
  it('projects rows onto the wire PolicyGate shape, omitting empty optionals', async () => {
    const { db } = makeDb([
      { gateKey: 'no-shell', tool: 'run_command', effect: 'block', directive: null, reason: 'prod safety' },
      { gateKey: 'be-careful', tool: null, effect: 'inject-directive', directive: 'Prefer small diffs.', reason: null },
    ]);

    const gates = await loadPolicyGates(db, { tenantId: 1, projectId: 7, agentRef: 'ada' });

    expect(gates).toEqual([
      { id: 'no-shell', tool: 'run_command', effect: 'block', reason: 'prod safety' },
      { id: 'be-careful', effect: 'inject-directive', directive: 'Prefer small diffs.' },
    ]);
  });

  it('drops a row whose effect is not a known PolicyGate effect', async () => {
    const { db } = makeDb([
      { gateKey: 'bogus', tool: null, effect: 'nuke-everything', directive: null, reason: null },
      { gateKey: 'good', tool: null, effect: 'block', directive: null, reason: null },
    ]);

    const gates = await loadPolicyGates(db, { tenantId: 1 });

    expect(gates.map((g) => g.id)).toEqual(['good']);
  });

  it('returns [] when the tenant has authored nothing (the ungated default)', async () => {
    const { db } = makeDb([]);
    expect(await loadPolicyGates(db, { tenantId: 1 })).toEqual([]);
  });
});

describe('resolvePolicyGates — end-to-end into the evaluator', () => {
  it('a tool:"*" block gate makes a deny-by-default posture authorable', async () => {
    const { db } = makeDb([
      { gateKey: 'deny-all', tool: '*', effect: 'block', directive: null, reason: 'locked down' },
    ]);

    const gates = await resolvePolicyGates(env, db, { tenantId: 42 });

    // The exact call the engine makes at its tool seam.
    expect(evaluatePolicyGate(gates, 'write_file')).toEqual({
      action: 'block', gateId: 'deny-all', reason: 'locked down',
    });
    expect(evaluatePolicyGate(gates, 'anything_at_all').action).toBe('block');
  });

  it('a tool-specific gate leaves every other tool allowed', async () => {
    const { db } = makeDb([
      { gateKey: 'ask-first', tool: 'open_pull_request', effect: 'require-approval', directive: null, reason: null },
    ]);

    const gates = await resolvePolicyGates(env, db, { tenantId: 43 });

    expect(evaluatePolicyGate(gates, 'open_pull_request')).toEqual({
      action: 'require-approval', gateId: 'ask-first', reason: 'approval required by policy',
    });
    expect(evaluatePolicyGate(gates, 'read_file')).toEqual({ action: 'allow' });
  });
});

describe('resolvePolicyGates — read-through cache', () => {
  it('serves the second read from cache without re-querying', async () => {
    const { db, calls } = makeDb([
      { gateKey: 'g1', tool: null, effect: 'block', directive: null, reason: null },
    ]);

    await resolvePolicyGates(env, db, { tenantId: 50, projectId: 3, agentRef: 'ada' });
    await resolvePolicyGates(env, db, { tenantId: 50, projectId: 3, agentRef: 'ada' });

    expect(calls.count).toBe(1);
  });

  it('keys by scope — a different project/agent does NOT reuse the cached resolution', async () => {
    const { db, calls } = makeDb([]);

    await resolvePolicyGates(env, db, { tenantId: 51, projectId: 1, agentRef: 'ada' });
    await resolvePolicyGates(env, db, { tenantId: 51, projectId: 2, agentRef: 'ada' });
    await resolvePolicyGates(env, db, { tenantId: 51, projectId: 1, agentRef: 'bob' });
    await resolvePolicyGates(env, db, { tenantId: 51, projectId: 1 });

    expect(calls.count).toBe(4);
  });

  it('a write invalidates the tenant and the next read sees the NEW posture', async () => {
    const rows: GateRow[] = [
      { gateKey: 'old', tool: null, effect: 'inject-directive', directive: 'be nice', reason: null },
    ];
    const calls = { count: 0 };
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => { calls.count += 1; return [...rows]; },
            }),
          }),
        }),
      }),
    } as unknown as Db;

    const before = await resolvePolicyGates(env, db, { tenantId: 52 });
    expect(before.map((g) => g.id)).toEqual(['old']);

    // An operator adds a hard block. Every write path funnels through this.
    rows.push({ gateKey: 'new-block', tool: 'run_command', effect: 'block', directive: null, reason: null });
    await invalidatePolicyCache(env, 52);

    const after = await resolvePolicyGates(env, db, { tenantId: 52 });
    expect(after.map((g) => g.id)).toEqual(['old', 'new-block']);
    expect(calls.count).toBe(2);
    expect(evaluatePolicyGate(after, 'run_command').action).toBe('block');
  });

  it('invalidating one tenant leaves another tenant\'s cached resolution intact', async () => {
    const { db, calls } = makeDb([]);

    await resolvePolicyGates(env, db, { tenantId: 60 });
    await resolvePolicyGates(env, db, { tenantId: 61 });
    expect(calls.count).toBe(2);

    await invalidatePolicyCache(env, 60);

    await resolvePolicyGates(env, db, { tenantId: 61 }); // still cached
    expect(calls.count).toBe(2);

    await resolvePolicyGates(env, db, { tenantId: 60 }); // orphaned → reloads
    expect(calls.count).toBe(3);
  });

  it('invalidation is best-effort — a missing env never throws into a write path', async () => {
    await expect(invalidatePolicyCache(undefined as unknown as Env, 1)).resolves.toBeUndefined();
  });
});
