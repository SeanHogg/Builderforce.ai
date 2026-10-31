/**
 * Which packs a scope selects, proved on the query itself.
 *
 * The other policyPackService tests answer the resolver's SQL with canned rows, so they would pass
 * whatever the `where` clause said. A channel or cron run is held to the TENANT's gates only: it has no
 * project and no agent, and a pack pinned to either must never apply to it. This captures the real
 * `where` Drizzle builds for a scope and renders it to SQL, so a regression in the predicate fails here.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { loadPolicyGates } from './policyPackService';
import type { Db } from '../../infrastructure/database/connection';

/** Run `loadPolicyGates` against a db that records the SQL of its `where`. */
async function selectedBy(scope: Parameters<typeof loadPolicyGates>[1]) {
  let captured: unknown;
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (condition: unknown) => {
            captured = condition;
            return { orderBy: async () => [] };
          },
        }),
      }),
    }),
  } as unknown as Db;
  await loadPolicyGates(db, scope);
  return new PgDialect().sqlToQuery(captured as Parameters<PgDialect['sqlToQuery']>[0]);
}

describe('loadPolicyGates — which packs a scope selects', () => {
  it('a tenant-only scope selects the tenant\'s enabled packs with NO project pin and NO agent pin', async () => {
    const { sql, params } = await selectedBy({ tenantId: 8 });

    expect(sql).toContain('"policy_packs"."tenant_id" = $');
    expect(sql).toContain('"policy_packs"."enabled" = $');
    expect(sql).toContain('"policy_packs"."project_id" is null');
    expect(sql).toContain('"policy_packs"."agent_ref" is null');
    // a pinned pack never matches: nothing compares the pin columns to a value
    expect(sql).not.toContain('"policy_packs"."project_id" = $');
    expect(sql).not.toContain('"policy_packs"."agent_ref" = $');
    expect(params).toEqual([8, true]);
  });

  it('null project and agent behave exactly like omitted ones', async () => {
    const omitted = await selectedBy({ tenantId: 8 });
    const nulls = await selectedBy({ tenantId: 8, projectId: null, agentRef: null });
    const blank = await selectedBy({ tenantId: 8, agentRef: '   ' });

    expect(nulls).toEqual(omitted);
    expect(blank).toEqual(omitted);
  });

  it('a project + agent scope ALSO takes the packs pinned to exactly that project and agent', async () => {
    const { sql, params } = await selectedBy({ tenantId: 8, projectId: 7, agentRef: 'ada' });

    expect(sql).toContain('"policy_packs"."project_id" is null or "policy_packs"."project_id" = $');
    expect(sql).toContain('"policy_packs"."agent_ref" is null or "policy_packs"."agent_ref" = $');
    expect(params).toEqual([8, true, 7, 'ada']);
  });

  it('the tenant is always part of the predicate (one tenant never reads another\'s packs)', async () => {
    const a = await selectedBy({ tenantId: 1 });
    const b = await selectedBy({ tenantId: 2 });

    expect(a.params[0]).toBe(1);
    expect(b.params[0]).toBe(2);
  });
});
