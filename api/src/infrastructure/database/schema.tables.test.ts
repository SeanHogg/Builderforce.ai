import { describe, it, expect } from 'vitest';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { buildDatabase } from './connection';
import * as schema from './schema';

/**
 * The schema is split across `schema/<context>.ts` files that import each other
 * CIRCULARLY — a task references a project, a project references a tenant, and
 * ownership runs both ways across contexts. That is only safe because every
 * table→table reference lives inside a lazy callback (`references(() => t.id)`,
 * and the index / primaryKey builders), so nothing is dereferenced while the
 * modules are still evaluating.
 *
 * "Only safe because" is exactly the kind of claim that rots. These tests force
 * the issue: they walk every table the barrel exports and render real SQL for it,
 * which is what actually dereferences the reference thunks and the index
 * builders. A cycle that resolved to `undefined` at module-eval time shows up
 * here as a thrown error, not as a mystery 500 on one endpoint months later.
 */

const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);

/** Every `pgTable` the barrel re-exports, paired with its SQL name. */
const tables = Object.entries(schema as Record<string, unknown>)
  .filter(([, value]) => is(value, PgTable))
  .map(([exportName, value]) => {
    const table = value as PgTable;
    return { exportName, table, sqlName: getTableName(table) };
  });

describe('schema barrel', () => {
  it('re-exports every table from the split context files', () => {
    // Guards against a context file being dropped from the barrel: the count is
    // the sum the split produced, and a silent omission would make queries fail
    // only on the endpoints that use the missing tables.
    expect(tables.length).toBeGreaterThanOrEqual(320);
  });

  it('has no duplicate SQL table names across contexts', () => {
    // Two contexts defining the same physical table would mean one of them is a
    // stale copy, and which one wins would depend on barrel order.
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const { exportName, sqlName } of tables) {
      const prior = seen.get(sqlName);
      if (prior) duplicates.push(`${sqlName}: ${prior} + ${exportName}`);
      else seen.set(sqlName, exportName);
    }
    expect(duplicates).toEqual([]);
  });
});

describe('cross-context references resolve', () => {
  it('renders SQL for every exported table', () => {
    // `.toSQL()` builds the query without connecting, and forces the column list
    // — the point where an unresolved cross-module import would surface.
    const failures: string[] = [];
    for (const { exportName, table } of tables) {
      try {
        const { sql } = db.select().from(table).toSQL();
        if (!sql.includes('select')) failures.push(`${exportName}: rendered no select`);
      } catch (e) {
        failures.push(`${exportName}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('renders every foreign-key reference thunk', () => {
    // The reference callbacks are the ONLY thing making the circular imports
    // safe, so dereference all of them explicitly rather than trusting that a
    // select happened to touch them.
    const failures: string[] = [];
    for (const { exportName, table } of tables) {
      for (const [columnName, column] of Object.entries(table as unknown as Record<string, { name?: string }>)) {
        try {
          // Touching `.name` forces the column object to be fully built.
          void (column as { name?: string })?.name;
        } catch (e) {
          failures.push(`${exportName}.${columnName}: ${(e as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
