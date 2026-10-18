import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { bumpGroupUserCountsSql } from './groupUserCounts';

describe('bumpGroupUserCountsSql', () => {
  it('is ONE tenant-scoped statement for any number of groups, and nothing for none', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const db = { execute: async (q: SQL) => { seen.push(new PgDialect().sqlToQuery(q)); return {}; } } as unknown as Db;
    await bumpGroupUserCountsSql(db, 5, [], new Date());
    expect(seen).toHaveLength(0);
    await bumpGroupUserCountsSql(db, 5, [{ groupId: 'g1', userKey: 'u1' }, { groupId: 'g2', userKey: 'u2' }], new Date());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sql).toContain('ON CONFLICT DO NOTHING');
    expect(seen[0]!.sql).toContain('g.tenant_id =');
    expect(seen[0]!.params).toContain(5);
  });
});
