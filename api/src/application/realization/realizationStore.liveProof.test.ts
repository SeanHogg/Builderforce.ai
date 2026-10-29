/**
 * `getLiveProofForProject` filters in SQL — this workspace, this project, status built, a
 * measure declared, newest first, one row — so a project with more than any page of newer
 * plans or unmeasured proofs still finds its proof.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { getLiveProofForProject } from './realizationStore';

const dialect = new PgDialect();

function fakeDb(rows: unknown[]) {
  const seen: { where?: SQL; limit?: number } = {};
  const chain = {
    from: () => chain,
    where: (cond: SQL) => { seen.where = cond; return chain; },
    orderBy: () => chain,
    limit: async (n: number) => { seen.limit = n; return rows; },
  };
  return { db: { select: () => chain } as never, seen };
}

describe('getLiveProofForProject', () => {
  it('asks for this workspace\'s built, measured proofs of this project and takes one', async () => {
    const { db, seen } = fakeDb([]);
    expect(await getLiveProofForProject(db, 7, 42)).toBeNull();
    const { sql, params } = dialect.sqlToQuery(seen.where!);
    expect(sql).toContain('"tenant_id" = $1');
    expect(sql).toContain('"project_id" = $2');
    expect(sql).toContain('"status" = $3');
    expect(sql).toContain('"measure" is not null');
    expect(params).toEqual([7, 42, 'built']);
    expect(seen.limit).toBe(1);
  });
});
